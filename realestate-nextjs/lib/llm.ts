/**
 * lib/llm.ts: LLM entry point. Re-exports the ModelClient interface (the
 * ONLY place in the codebase that calls the LLM), the real Gemini REST
 * client, and the deterministic rule-based mock. Python equivalent:
 * agent/models.py.
 */
export {
  RealGeminiClient,
  MockModelClient,
  ModelError,
  type ModelClient,
  type Classification,
  type EmailLike,
} from "./llm/client";
