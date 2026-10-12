/**
 * Gmail client. TypeScript port of gmail_client/.
 *
 * Interface + MockGmailClient (tests/dev) + RealGmailClient (googleapis,
 * lazy import so the module loads without the package).
 *
 * SAFETY: the only Gmail write path in this codebase is drafts.create
 * (see createDraft). There is NO send path; enforced by tests.
 */

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  fromAddr: string;
  replyTo?: string;
  date: string;
  body: string;
  labels: string[];
  hasAttachments: boolean;
  bodyTruncated: boolean;
}

export interface DraftResult {
  draftId: string;
  reused: boolean;
}

export interface GmailClient {
  /** New message IDs since historyId (or all, when absent). */
  listNew(historyId?: string): Promise<{ ids: string[]; historyId: string }>;
  getMessage(id: string): Promise<EmailMessage>;
  /** Idempotent draft creation: reuses an existing draft for the thread. */
  createDraft(
    threadId: string,
    to: string,
    subject: string,
    body: string,
    sourceMessageId: string
  ): Promise<DraftResult>;
}

// ---------------------------------------------------------------------------
// Mock (tests / dev)
// ---------------------------------------------------------------------------

export class MockGmailClient implements GmailClient {
  private messages = new Map<string, EmailMessage>();
  private drafts = new Map<string, DraftResult>(); // threadId -> draft
  private historyCounter = 0;

  addMessage(msg: EmailMessage): void {
    this.messages.set(msg.id, msg);
  }

  async listNew(_historyId?: string): Promise<{ ids: string[]; historyId: string }> {
    this.historyCounter += 1;
    return {
      ids: [...this.messages.keys()],
      historyId: String(this.historyCounter),
    };
  }

  async getMessage(id: string): Promise<EmailMessage> {
    const msg = this.messages.get(id);
    if (!msg) throw new Error(`mock: unknown message ${id}`);
    return msg;
  }

  async createDraft(
    threadId: string,
    _to: string,
    _subject: string,
    _body: string,
    _sourceMessageId: string
  ): Promise<DraftResult> {
    const existing = this.drafts.get(threadId);
    if (existing) return { ...existing, reused: true };
    const draft = {
      draftId: `draft-${threadId}-${Date.now()}`,
      reused: false,
    };
    this.drafts.set(threadId, draft);
    return draft;
  }

  /** Test helper: assert no send path was ever invoked. */
  draftCount(): number {
    return this.drafts.size;
  }
}

// ---------------------------------------------------------------------------
// Real (googleapis, lazy)
// ---------------------------------------------------------------------------

export interface RealGmailOptions {
  accessToken: string;
}

export class RealGmailClient implements GmailClient {
  private accessToken: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private gmail: any = null;

  constructor(opts: RealGmailOptions) {
    this.accessToken = opts.accessToken;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(): Promise<any> {
    if (!this.gmail) {
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: this.accessToken });
      this.gmail = google.gmail({ version: "v1", auth });
    }
    return this.gmail;
  }

  async listNew(historyId?: string): Promise<{ ids: string[]; historyId: string }> {
    const gmail = await this.api();
    if (!historyId) {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: "newer_than:1d",
        maxResults: 100,
      });
      const ids = (res.data.messages || []).map((m: { id: string }) => m.id);
      const profile = await gmail.users.getProfile({ userId: "me" });
      return { ids, historyId: String(profile.data.historyId || "0") };
    }
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId: historyId,
      historyTypes: ["messageAdded"],
    });
    const ids: string[] = [];
    for (const h of res.data.history || []) {
      for (const m of h.messagesAdded || []) {
        if (m.message?.id) ids.push(m.message.id);
      }
    }
    return { ids, historyId: String(res.data.historyId || historyId) };
  }

  async getMessage(id: string): Promise<EmailMessage> {
    const gmail = await this.api();
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const data = res.data;
    const headers: Record<string, string> = {};
    for (const h of data.payload?.headers || []) {
      headers[(h.name || "").toLowerCase()] = h.value || "";
    }
    return {
      id: data.id || "",
      threadId: data.threadId || "",
      subject: headers["subject"] || "",
      fromAddr: headers["from"] || "",
      replyTo: headers["reply-to"],
      date: headers["date"] || "",
      body: extractBody(data.payload),
      labels: data.labelIds || [],
      hasAttachments: hasAttachment(data.payload),
      bodyTruncated: false,
    };
  }

  async createDraft(
    threadId: string,
    to: string,
    subject: string,
    body: string,
    _sourceMessageId: string
  ): Promise<DraftResult> {
    const gmail = await this.api();
    // Idempotency: reuse an existing draft on the thread.
    const existing = await gmail.users.drafts.list({ userId: "me" });
    for (const d of existing.data.drafts || []) {
      const full = await gmail.users.drafts.get({
        userId: "me",
        id: d.id,
        format: "metadata",
      });
      if (full.data.message?.threadId === threadId) {
        return { draftId: d.id!, reused: true };
      }
    }
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { threadId, raw } },
    });
    return { draftId: res.data.id || "", reused: false };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf8");
    }
  }
  for (const part of payload.parts || []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAttachment(payload: any): boolean {
  if (!payload) return false;
  for (const part of payload.parts || []) {
    if (part.filename) return true;
    if (hasAttachment(part)) return true;
  }
  return false;
}
