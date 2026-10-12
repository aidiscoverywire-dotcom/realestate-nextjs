/**
 * lib/pipeline.ts: pipeline entry point. Re-exports the deterministic
 * driver (ingest -> classify -> extract -> cross-ref -> draft -> log), the
 * per-tenant service wiring, and the email normalization helpers. Python
 * equivalent: agent/pipeline.py + pipeline/runner.py.
 */
export {
  PipelineDriver,
  validateFields,
  STATUS_PROCESSED,
  STATUS_HUMAN_REVIEW,
  STATUS_NOISE_LOGGED,
  STATUS_DRAFT_FAILED,
  STATUS_ERROR,
  STATUS_DEAD_LETTER,
  type PipelineSettings,
  type PipelineTools,
  type PipelineReport,
  type LogRecord,
  type SheetLookup,
} from "./pipeline/driver";
export {
  buildTenantStack,
  runTenantPipeline,
  seedMockInbox,
  type TenantStack,
} from "./pipeline/service";
export {
  stripQuotedHistory,
  resolveRecipient,
  safeConfidence,
  type MessageHeaders,
} from "./pipeline/strip";
