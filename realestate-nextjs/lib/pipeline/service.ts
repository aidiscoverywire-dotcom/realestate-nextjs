/**
 * Pipeline service: wires the driver to persistence and external clients.
 *
 * TypeScript port of pipeline/runner.py (MultiTenantRunner, simplified for
 * the Next.js port). Each tenant gets an isolated stack: own Gmail/Sheets
 * clients (mock or real per env), own vault scope, own DB rows.
 *
 * Env: USE_MOCKS=true (default in dev/test) uses MockGmailClient,
 * MockSheetsClient, MockModelClient. Set false with real credentials in
 * the vault for production wiring.
 */
import { prisma, assertTenantActive } from "../db/client";
import {
  MockGmailClient,
  RealGmailClient,
  type EmailMessage,
  type GmailClient,
} from "../gmail/client";
import { MockModelClient, RealGeminiClient, type ModelClient } from "../llm/client";
import {
  MockSheetsClient,
  RealSheetsClient,
  type SheetsClient,
} from "../sheets/client";
import { vaultStore } from "../vault/store";
import {
  PipelineDriver,
  type LogRecord,
  type PipelineReport,
  type PipelineTools,
} from "./driver";
import type { Flag, LeadRow, PropertyRow } from "../domain/realEstate";

export interface TenantStack {
  tenantId: string;
  gmail: GmailClient;
  sheets: SheetsClient;
  model: ModelClient;
  driver: PipelineDriver;
}

function useMocks(): boolean {
  return process.env.USE_MOCKS !== "false";
}

async function buildModel(tenantId: string): Promise<ModelClient> {
  if (useMocks()) return new MockModelClient();
  const apiKey = await vaultStore.get(tenantId, "gemini_api_key");
  return new RealGeminiClient({ apiKey });
}

async function buildGmail(
  tenantId: string,
  mailbox: string
): Promise<GmailClient> {
  if (useMocks()) return new MockGmailClient();
  const tokenJson = await vaultStore.get(tenantId, "google_oauth_tokens");
  const tokens = JSON.parse(tokenJson) as { access_token: string };
  return new RealGmailClient({ accessToken: tokens.access_token });
}

async function buildSheets(
  tenantId: string,
  spreadsheetId: string
): Promise<SheetsClient> {
  if (useMocks()) return new MockSheetsClient();
  const tokenJson = await vaultStore.get(tenantId, "google_oauth_tokens");
  const tokens = JSON.parse(tokenJson) as { access_token: string };
  return new RealSheetsClient({
    accessToken: tokens.access_token,
    spreadsheetId,
  });
}

function sheetTabFor(role: "contacts" | "entities"): string {
  // Default tab names from the real_estate pack; per-tenant mapping is
  // roadmap (stored in tenant config in the Python build).
  return role === "contacts" ? "Leads" : "Properties";
}

export async function buildTenantStack(tenantId: string): Promise<TenantStack> {
  await assertTenantActive(tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
  });

  const gmail = await buildGmail(tenantId, tenant.mailbox);
  const sheets = await buildSheets(tenantId, "");
  const model = await buildModel(tenantId);

  const tools: PipelineTools = {
    async createDraft(threadId, to, subject, body, messageId, flags) {
      // Idempotent draft creation via the Gmail client, then persist.
      const draft = await gmail.createDraft(
        threadId,
        to,
        subject,
        body,
        messageId
      );
      const email = await prisma.emailMessage.findFirst({
        where: { tenantId, gmailId: messageId },
      });
      await prisma.draft.create({
        data: {
          tenantId,
          emailId: email?.id || messageId,
          gmailDraftId: draft.draftId,
          to,
          subject,
          body,
          flags: flags as string[],
          reused: draft.reused,
        },
      });
      return { draftId: draft.draftId, reused: draft.reused };
    },

    async logDeal(record: LogRecord) {
      await prisma.logEntry.create({
        data: {
          tenantId,
          messageId: record.messageId,
          category: record.category,
          confidence:
            typeof record.confidence === "number" ? record.confidence : 0,
          contactName: record.contactName,
          contactEmail: record.contactEmail,
          address: record.address,
          crossRef: record.crossRef,
          flags: record.flags as string[],
          draftId: record.draftId,
          retryCount: record.retryCount,
          status: record.status,
          internalNote: record.internalNote || "",
        },
      });
    },

    async lookupSheet(role, _filters) {
      if (useMocks()) {
        // Serve from the SheetCache table (seeded in dev/test).
        const cached = await prisma.sheetCache.findUnique({
          where: { tenantId_role: { tenantId, role } },
        });
        const rows = (cached?.rows as Array<Record<string, string>>) || [];
        return { rows: rows as Array<LeadRow & PropertyRow & Record<string, string>> };
      }
      const rows = await sheets.readTab(sheetTabFor(role));
      return { rows: rows as Array<LeadRow & PropertyRow & Record<string, string>> };
    },
  };

  const driver = new PipelineDriver(
    model,
    tools,
    {
      mailbox: tenant.mailbox,
      confidenceThreshold: tenant.confidenceThreshold,
    },
    gmail
  );

  return { tenantId, gmail, sheets, model, driver };
}

/**
 * Run one poll for a tenant: retry/dead-letter pass is roadmap;
 * this port processes new mail once per trigger (idempotent via the
 * unique (tenantId, gmailId) constraint; re-runs skip seen mail).
 */
export async function runTenantPipeline(
  tenantId: string
): Promise<{ processed: number; reports: PipelineReport[] }> {
  const stack = await buildTenantStack(tenantId);
  const { ids, historyId } = await stack.gmail.listNew();
  void historyId;

  const reports: PipelineReport[] = [];
  let processed = 0;
  for (const id of ids) {
    const seen = await prisma.emailMessage.findUnique({
      where: { tenantId_gmailId: { tenantId, gmailId: id } },
    });
    if (seen) continue;
    const message: EmailMessage = await stack.gmail.getMessage(id);
    await prisma.emailMessage.create({
      data: {
        tenantId,
        gmailId: message.id,
        threadId: message.threadId,
        subject: message.subject,
        fromAddr: message.fromAddr,
        date: message.date,
        status: "queued",
      },
    });
    const report = await stack.driver.processEmail(message);
    processed += 1;
    reports.push(report);
    if (report.status) {
      await prisma.emailMessage.updateMany({
        where: { tenantId, gmailId: id },
        data: {
          category: report.category || "",
          confidence: report.confidence || 0,
          status: report.status,
        },
      });
    }
  }
  return { processed, reports };
}

/** Seed helper for dev/test: inject mock mail + reference rows. */
export async function seedMockInbox(
  tenantId: string,
  messages: EmailMessage[],
  contacts: LeadRow[],
  entities: PropertyRow[]
): Promise<void> {
  const stack = await buildTenantStack(tenantId);
  if (!(stack.gmail instanceof MockGmailClient)) {
    throw new Error("seedMockInbox requires USE_MOCKS=true");
  }
  for (const m of messages) stack.gmail.addMessage(m);
  await prisma.sheetCache.upsert({
    where: { tenantId_role: { tenantId, role: "contacts" } },
    update: { rows: contacts as unknown as object },
    create: {
      tenantId,
      role: "contacts",
      rows: contacts as unknown as object,
    },
  });
  await prisma.sheetCache.upsert({
    where: { tenantId_role: { tenantId, role: "entities" } },
    update: { rows: entities as unknown as object },
    create: {
      tenantId,
      role: "entities",
      rows: entities as unknown as object,
    },
  });
}

export type { Flag };
