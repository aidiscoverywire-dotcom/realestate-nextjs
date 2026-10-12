/**
 * PipelineDriver: the deterministic six-stage pipeline.
 *
 * TypeScript port of agent/pipeline.py. Fixed order, no branches around it:
 * ingest → classify → extract → cross-ref → draft → log. The LLM supplies
 * judgment (via ModelClient); code supplies discipline (thresholds,
 * validation, idempotency, no-send).
 *
 * Domain-free: categories, schemas, matching, prompts, and record layouts
 * come from the domain pack. This module only orchestrates the fixed stages.
 */

import {
  CONFIDENCE_THRESHOLD,
  HALT_FLAGS,
  NOISE_CATEGORY,
  crossReference,
  detectDataConflict,
  renderInternalBlock,
  type Category,
  type Flag,
  type LeadRow,
  type MatchResult,
  type PropertyRow,
} from "../domain/realEstate";
import { validateFields } from "../extractor";
import type { EmailMessage, GmailClient } from "../gmail/client";
import type { ModelClient } from "../llm/client";
import {
  resolveRecipient,
  safeConfidence,
  stripQuotedHistory,
} from "./strip";

export const STATUS_PROCESSED = "processed";
export const STATUS_HUMAN_REVIEW = "human_review";
export const STATUS_NOISE_LOGGED = "noise_logged";
export const STATUS_DRAFT_FAILED = "draft_failed";
export const STATUS_ERROR = "error";
export const STATUS_DEAD_LETTER = "dead_letter";

export interface PipelineSettings {
  mailbox?: string;
  confidenceThreshold?: number;
  priceConflictThreshold?: number;
}

export interface SheetLookup {
  (role: "contacts" | "entities", filters: Record<string, string>): Promise<{
    rows: Array<LeadRow & PropertyRow & Record<string, string>>;
  }>;
}

export interface PipelineTools {
  createDraft(
    threadId: string,
    to: string,
    subject: string,
    body: string,
    messageId: string,
    flags: Flag[]
  ): Promise<{ draftId: string; reused: boolean }>;
  logDeal(record: LogRecord): Promise<void>;
  lookupSheet: SheetLookup;
}

export interface LogRecord {
  timestamp: string;
  messageId: string;
  category: string;
  confidence: number | string;
  contactName: string;
  contactEmail: string;
  contactPhoneCanonical: string;
  address: string;
  price: string | number;
  beds: string | number;
  baths: string | number;
  dealStage: string;
  crossRef: string;
  flags: Flag[];
  draftId: string;
  retryCount: number;
  status: string;
  internalNote?: string;
}

export interface PipelineReport {
  messageId: string;
  retryCount: number;
  category?: string | null;
  confidence?: number | null;
  status?: string;
  flags?: Flag[];
  draftId?: string | null;
  draftReused?: boolean;
  error?: string;
  warnings?: string[];
  note?: string;
}

function utcNowIso(): string {
  return new Date().toISOString();
}

/** Validate + normalize extracted fields in CODE (see lib/extractor.ts).
 *  Pack-driven: only the category's allowed fields are validated; unknown
 *  fields are dropped with a warning. Re-exported here so existing
 *  imports keep working. */
export { validateFields } from "../extractor";

function buildFullRecord(args: {
  message: EmailMessage;
  category: string;
  confidence: number;
  extracted: Record<string, unknown>;
  matchResult: MatchResult;
  draftId: string | null;
  status: string;
  retryCount: number;
  timestamp: string;
}): LogRecord {
  const { message, category, confidence, extracted, matchResult } = args;
  const props = extracted.properties;
  const primary: Record<string, unknown> = { ...extracted };
  if (Array.isArray(props) && props.length > 1) {
    primary.address = (props[0] as Record<string, unknown>).address;
    primary.price = (props[0] as Record<string, unknown>).price;
  }
  const crossRef =
    [
      ...matchResult.conflicts.map((c) => c.type),
      ...matchResult.contactMatches.map((m) => `returning_lead(${m.leadId})`),
      ...matchResult.entityMatches.map(
        (m) => `property_found(${m.propertyId},${m.strength})`
      ),
    ].join("; ") || "no matches";
  const price =
    primary.price ?? primary.price_budget ?? primary.rent_budget ?? "";
  return {
    timestamp: args.timestamp,
    messageId: message.id,
    category,
    confidence,
    contactName: String(extracted.contact_name || ""),
    contactEmail: String(extracted.contact_email || ""),
    contactPhoneCanonical: String(extracted.contact_phone || ""),
    address: String(primary.address || ""),
    price: typeof price === "number" ? price : String(price || ""),
    beds: extracted.beds != null ? String(extracted.beds) : "",
    baths: extracted.baths != null ? String(extracted.baths) : "",
    dealStage: String(extracted.deal_stage || ""),
    crossRef,
    flags: matchResult.flags,
    draftId: args.draftId || "",
    retryCount: args.retryCount,
    status: args.status,
    internalNote: renderInternalBlock(matchResult),
  };
}

function buildMinimalRecord(args: {
  message: EmailMessage;
  category: string;
  confidence: number;
  status: string;
  flags: Flag[];
  retryCount: number;
  timestamp: string;
  note?: string;
}): LogRecord {
  return {
    timestamp: args.timestamp,
    messageId: args.message.id,
    category: args.category,
    confidence: args.confidence,
    contactName: "",
    contactEmail: "",
    contactPhoneCanonical: "",
    address: "",
    price: "",
    beds: "",
    baths: "",
    dealStage: "",
    crossRef: args.note || "",
    flags: args.flags,
    draftId: "",
    retryCount: args.retryCount,
    status: args.status,
  };
}

export class PipelineDriver {
  private model: ModelClient;
  private tools: PipelineTools;
  private settings: Required<Pick<PipelineSettings, "confidenceThreshold" | "priceConflictThreshold">> &
    PipelineSettings;
  private gmail: GmailClient;

  constructor(
    model: ModelClient,
    tools: PipelineTools,
    settings: PipelineSettings,
    gmail: GmailClient
  ) {
    this.model = model;
    this.tools = tools;
    this.gmail = gmail;
    this.settings = {
      ...settings,
      confidenceThreshold:
        settings.confidenceThreshold ?? CONFIDENCE_THRESHOLD,
      priceConflictThreshold:
        settings.priceConflictThreshold ?? 0.02,
    };
  }

  /** Full pipeline for one message. Never raises; stage failures are
   *  captured as error rows. */
  async processEmail(
    message: EmailMessage,
    retryCount = 0
  ): Promise<PipelineReport> {
    const report: PipelineReport = {
      messageId: message.id,
      retryCount,
    };
    try {
      return await this.run(message, retryCount, report);
    } catch (exc) {
      const error = `${(exc as Error).constructor.name}: ${(exc as Error).message}`;
      report.category = null;
      report.confidence = null;
      report.status = STATUS_ERROR;
      report.error = error;
      report.flags = [];
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category: "",
          confidence: 0,
          status: STATUS_ERROR,
          flags: [],
          retryCount,
          timestamp: utcNowIso(),
          note: error.slice(0, 200),
        })
      );
      return report;
    }
  }

  private async run(
    message: EmailMessage,
    retryCount: number,
    report: PipelineReport
  ): Promise<PipelineReport> {
    const ts = () => utcNowIso();

    // Stage 0: self-mail filter.
    const labels = new Set((message.labels || []).map((l) => l.toUpperCase()));
    const own = (this.settings.mailbox || "").trim().toLowerCase();
    const fromAddr = (message.fromAddr || "").trim().toLowerCase();
    if (
      labels.has("DRAFT") ||
      labels.has("SENT") ||
      (own !== "" && fromAddr === own)
    ) {
      report.category = NOISE_CATEGORY;
      report.confidence = 0.0;
      report.status = STATUS_NOISE_LOGGED;
      report.flags = [];
      report.note = "self-mail filtered";
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category: NOISE_CATEGORY,
          confidence: 0.0,
          status: STATUS_NOISE_LOGGED,
          flags: [],
          retryCount,
          timestamp: ts(),
        })
      );
      return report;
    }

    // Stage 1: ingest (normalize), strip quoted history.
    const cleaned = stripQuotedHistory(message.body || "");
    const emailDate = message.date || "";

    // Stage 2: classify.
    let classification;
    try {
      classification = await this.model.classifyEmail(message, cleaned);
    } catch (exc) {
      const error = `classification failed: ${(exc as Error).message}`;
      report.status = STATUS_ERROR;
      report.error = error;
      report.flags = [];
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category: "",
          confidence: 0,
          status: STATUS_ERROR,
          flags: [],
          retryCount,
          timestamp: ts(),
          note: error.slice(0, 200),
        })
      );
      return report;
    }
    let category = classification.category;
    let confidence = safeConfidence(classification.confidence);
    if (!["lead", "contract_update", "rental_inquiry", "noise"].includes(category)) {
      category = NOISE_CATEGORY;
      confidence = 0.0;
    }
    report.category = category;
    report.confidence = confidence;

    // Threshold gate: low confidence -> human_review.
    if (confidence < this.settings.confidenceThreshold) {
      report.status = STATUS_HUMAN_REVIEW;
      report.flags = [];
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category,
          confidence,
          status: STATUS_HUMAN_REVIEW,
          flags: [],
          retryCount,
          timestamp: ts(),
        })
      );
      return report;
    }

    // Noise: minimal row, never re-processed.
    if (category === NOISE_CATEGORY) {
      report.status = STATUS_NOISE_LOGGED;
      report.flags = [];
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category,
          confidence,
          status: STATUS_NOISE_LOGGED,
          flags: [],
          retryCount,
          timestamp: ts(),
        })
      );
      return report;
    }

    // Stage 3: extract.
    let rawExtracted;
    try {
      rawExtracted = await this.model.extractFields(
        message,
        category,
        emailDate,
        cleaned
      );
    } catch (exc) {
      const error = `extraction failed: ${(exc as Error).message}`;
      report.status = STATUS_ERROR;
      report.error = error;
      report.flags = [];
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category: category || "",
          confidence: typeof confidence === "number" ? confidence : 0,
          status: STATUS_ERROR,
          flags: [],
          retryCount,
          timestamp: ts(),
          note: error.slice(0, 200),
        })
      );
      return report;
    }
    const { extracted, warnings } = validateFields(category, rawExtracted);
    report.warnings = warnings;
    if (!extracted.contact_email && message.fromAddr) {
      extracted.contact_email = message.fromAddr.trim();
    }
    extracted.has_attachments = message.hasAttachments;
    extracted.body_truncated = message.bodyTruncated;
    if (detectDataConflict(cleaned)) {
      extracted.data_conflict = true;
    }

    // Reference fallback for missing address (contract_update) runs below
    // with real lookup data, before cross-reference.

    // Stage 4: cross-reference.
    const refRows = await this.loadReferenceRows();
    // Re-run the reference fallback with real lookup data.
    if (category === "contract_update" && !extracted.address) {
      const leads = refRows.contacts;
      const cp = String(extracted.counterparty || "").trim().toLowerCase();
      if (cp) {
        const cpTokens = new Set(cp.match(/[a-z0-9]+/g) || []);
        for (const lead of leads) {
          const nameTokens = new Set(
            String(lead.name || "")
              .toLowerCase()
              .match(/[a-z0-9]+/g) || []
          );
          if ([...cpTokens].every((t) => nameTokens.has(t))) {
            const addr = String(lead.interest_address || "").trim();
            if (addr) {
              extracted.address = addr;
              extracted.address_source = "contacts_sheet";
              break;
            }
          }
        }
      }
    }
    const matchResult = crossReference(
      extracted,
      category,
      refRows,
      { priceConflictThreshold: this.settings.priceConflictThreshold },
      cleaned
    );
    const flags = matchResult.flags;
    report.flags = flags;

    // Halt flags -> human_review.
    if (flags.some((f) => (HALT_FLAGS as string[]).includes(f))) {
      report.status = STATUS_HUMAN_REVIEW;
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category,
          confidence,
          status: STATUS_HUMAN_REVIEW,
          flags,
          retryCount,
          timestamp: ts(),
        })
      );
      return report;
    }

    // Stage 5: draft (idempotent via thread draft-check inside the client).
    const to = resolveRecipient(message);
    let subject = message.subject || "";
    if (!subject.toLowerCase().startsWith("re:")) {
      subject = subject ? `Re: ${subject}` : "Re: your inquiry";
    }
    let draftText: string;
    try {
      draftText = await this.model.draftReplyBody(
        extracted,
        matchResult,
        emailDate
      );
    } catch (exc) {
      const error = `draft generation failed: ${(exc as Error).message}`;
      report.status = STATUS_ERROR;
      report.error = error;
      await this.tools.logDeal(
        buildMinimalRecord({
          message,
          category,
          confidence,
          status: STATUS_ERROR,
          flags,
          retryCount,
          timestamp: ts(),
          note: error.slice(0, 200),
        })
      );
      return report;
    }
    let draftId: string | null;
    try {
      const draft = await this.tools.createDraft(
        message.threadId,
        to,
        subject,
        draftText,
        message.id,
        flags
      );
      draftId = draft.draftId;
      report.draftId = draftId;
      report.draftReused = draft.reused;
    } catch (exc) {
      const error = `draft creation failed: ${(exc as Error).message}`;
      report.status = STATUS_DRAFT_FAILED;
      report.error = error;
      report.draftId = null;
      await this.tools.logDeal(
        buildFullRecord({
          message,
          category,
          confidence,
          extracted,
          matchResult,
          draftId: null,
          status: STATUS_DRAFT_FAILED,
          retryCount,
          timestamp: ts(),
        })
      );
      return report;
    }

    // Stage 6: log (append-only, once, complete row).
    report.status = STATUS_PROCESSED;
    await this.tools.logDeal(
      buildFullRecord({
        message,
        category,
        confidence,
        extracted,
        matchResult,
        draftId,
        status: STATUS_PROCESSED,
        retryCount,
        timestamp: ts(),
      })
    );
    return report;
  }

  private async loadReferenceRows(): Promise<{
    contacts: LeadRow[];
    entities: PropertyRow[];
  }> {
    const [contactsRes, entitiesRes] = await Promise.all([
      this.tools.lookupSheet("contacts", {}),
      this.tools.lookupSheet("entities", {}),
    ]);
    return {
      contacts: contactsRes.rows as LeadRow[],
      entities: entitiesRes.rows as PropertyRow[],
    };
  }
}
