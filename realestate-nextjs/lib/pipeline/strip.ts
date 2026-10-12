/**
 * Email normalization helpers. TypeScript port of agent/pipeline.py
 * (strip_quoted_history, resolve_recipient, _safe_confidence).
 */

const QUOTE_HEADER_RE = /^\s*On\b.*wrote:\s*$/i;
const WRAPPED_QUOTE_START_RE = /^\s*On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i;
const ORIGINAL_MSG_RE = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
const FORWARDED_MSG_RE = /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/i;
const FWD_HEADER_RE = /^\s*(From|Date|Subject|To|Cc|Reply-To)\s*:/i;

/**
 * Remove quoted reply history before classification/extraction.
 * - `>`-quoted lines are dropped.
 * - "On ... wrote:" (incl. line-wrapped variants) and
 *   "---Original Message---" cut everything after them.
 * - "---Forwarded message---" is NOT cut: only the separator and its
 *   header block are skipped; the forwarded content is kept.
 */
export function stripQuotedHistory(body: string): string {
  const out: string[] = [];
  const lines = body.split("\n");
  let i = 0;
  const n = lines.length;
  let skippingFwdHeaders = false;
  while (i < n) {
    const line = lines[i];
    i += 1;
    if (line.trimStart().startsWith(">")) continue;
    if (QUOTE_HEADER_RE.test(line) || ORIGINAL_MSG_RE.test(line)) break;
    if (WRAPPED_QUOTE_START_RE.test(line)) {
      let j = i;
      while (
        j < n &&
        j - i < 4 &&
        !lines[j].trimEnd().endsWith("wrote:")
      ) {
        j += 1;
      }
      if (j < n && lines[j].trimEnd().endsWith("wrote:")) {
        break; // everything after is quoted history
      }
      out.push(line);
      continue;
    }
    if (FORWARDED_MSG_RE.test(line)) {
      skippingFwdHeaders = true;
      continue;
    }
    if (skippingFwdHeaders) {
      if (!line.trim() || FWD_HEADER_RE.test(line)) continue;
      skippingFwdHeaders = false; // payload starts here
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export interface MessageHeaders {
  fromAddr: string;
  replyTo?: string;
}

/**
 * Recipient resolution in CODE. Reply-To wins only when its domain matches
 * the From domain; otherwise the From address. Body text like
 * "reply to attacker@…" can never redirect the draft.
 */
export function resolveRecipient(msg: MessageHeaders): string {
  const fromAddr = (msg.fromAddr || "").trim();
  const replyTo = (msg.replyTo || "").trim();
  if (replyTo.includes("@") && fromAddr.includes("@")) {
    const fromDomain = fromAddr.split("@").pop()!.toLowerCase();
    const replyDomain = replyTo.split("@").pop()!.toLowerCase();
    if (fromDomain && fromDomain === replyDomain) return replyTo;
  }
  return fromAddr;
}

/**
 * Model confidence MUST be a finite probability in [0,1].
 * NaN slips past every `< threshold` comparison, and raw scores like 85
 * are not probabilities. Clamp into range; map NaN/inf/unparseable to 0.0
 * (human_review), never let them through.
 */
export function safeConfidence(value: unknown): number {
  let c: number;
  try {
    c = Number(value);
  } catch {
    return 0.0;
  }
  if (!isFinite(c)) return 0.0;
  return Math.max(0, Math.min(1, c));
}
