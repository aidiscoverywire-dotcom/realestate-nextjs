/**
 * lib/gmail.ts: Gmail entry point. Re-exports the client interface,
 * the mock (tests/dev), and the real googleapis client. Python
 * equivalent: the gmail_client/ package.
 *
 * SAFETY: the only Gmail write path anywhere is drafts.create.
 * There is no send path; enforced by tests.
 */
export {
  MockGmailClient,
  RealGmailClient,
  type EmailMessage,
  type DraftResult,
  type GmailClient,
  type RealGmailOptions,
} from "./gmail/client";
