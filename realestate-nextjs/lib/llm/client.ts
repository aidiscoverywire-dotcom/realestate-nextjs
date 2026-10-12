/**
 * ModelClient: the ONLY place in the codebase that calls the LLM.
 *
 * TypeScript port of agent/models.py. All LLM judgment (classify, extract,
 * draft wording) lives here. The pipeline driver calls it with plain data
 * objects; it never touches Gmail/Sheets APIs or the vault.
 *
 * Implementations: RealGeminiClient (direct REST fetch, no SDK), MockModelClient.
 */
import {
  CLASSIFIER_PROMPT,
  DRAFTER_PROMPT,
  EXTRACTOR_PROMPT_TEMPLATE,
  mockDraft,
  type Category,
  type MatchResult,
} from "../domain/realEstate";
import { classifyByKeywords } from "../classifier";
import { extractByRules } from "../extractor";

export interface EmailLike {
  id: string;
  subject: string;
  fromAddr: string;
  body: string;
}

export interface Classification {
  category: Category;
  confidence: number;
  rationale: string;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

export interface ModelClient {
  classifyEmail(
    message: EmailLike,
    cleanedBody: string
  ): Promise<Classification>;
  extractFields(
    message: EmailLike,
    category: Category,
    emailDate: string,
    cleanedBody: string
  ): Promise<Record<string, unknown>>;
  draftReplyBody(
    extracted: Record<string, unknown>,
    matchResult: MatchResult,
    emailDate: string
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Real client: Gemini REST API via fetch (no SDK dependency)
// ---------------------------------------------------------------------------

interface GeminiOptions {
  apiKey: string;
  classifyModel?: string;
  draftModel?: string;
}

export class RealGeminiClient implements ModelClient {
  private apiKey: string;
  private classifyModel: string;
  private draftModel: string;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey) throw new ModelError("Gemini API key is empty");
    this.apiKey = opts.apiKey;
    this.classifyModel = opts.classifyModel || "gemini-3.8-flash";
    this.draftModel = opts.draftModel || "gemini-3.1-pro";
  }

  private async generateJson(model: string, prompt: string): Promise<unknown> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      throw new ModelError(`Gemini API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      throw new ModelError("Gemini returned unparsable JSON");
    }
  }

  private async generateText(model: string, prompt: string): Promise<string> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      throw new ModelError(`Gemini API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  async classifyEmail(
    message: EmailLike,
    cleanedBody: string
  ): Promise<Classification> {
    const prompt =
      `${CLASSIFIER_PROMPT}\n\nSubject: ${message.subject}\nFrom: ${message.fromAddr}\n\n${cleanedBody}`;
    const raw = (await this.generateJson(this.classifyModel, prompt)) as Record<string, unknown>;
    return {
      category: (raw.category as Category) || "noise",
      confidence: Number(raw.confidence ?? 0),
      rationale: String(raw.rationale || ""),
    };
  }

  async extractFields(
    message: EmailLike,
    category: Category,
    emailDate: string,
    cleanedBody: string
  ): Promise<Record<string, unknown>> {
    const prompt =
      EXTRACTOR_PROMPT_TEMPLATE.replace("{category}", category).replace(
        "{emailDate}",
        emailDate
      ) +
      `\n\nSubject: ${message.subject}\nFrom: ${message.fromAddr}\n\n${cleanedBody}`;
    const raw = await this.generateJson(this.classifyModel, prompt);
    return (raw as Record<string, unknown>) || {};
  }

  async draftReplyBody(
    extracted: Record<string, unknown>,
    matchResult: MatchResult,
    emailDate: string
  ): Promise<string> {
    const prompt =
      `${DRAFTER_PROMPT}\n\nVALIDATED FIELDS:\n${JSON.stringify(extracted, null, 2)}` +
      `\n\nCROSS-REFERENCE:\n${JSON.stringify(matchResult, null, 2)}` +
      `\n\nEmail date: ${emailDate}`;
    return this.generateText(this.draftModel, prompt);
  }
}

// ---------------------------------------------------------------------------
// Mock client (tests / dev); deterministic, rule-based, no network
// ---------------------------------------------------------------------------

export class MockModelClient implements ModelClient {
  async classifyEmail(
    _message: EmailLike,
    cleanedBody: string
  ): Promise<Classification> {
    return classifyByKeywords(cleanedBody);
  }

  async extractFields(
    message: EmailLike,
    category: Category,
    _emailDate: string,
    cleanedBody: string
  ): Promise<Record<string, unknown>> {
    // Rule-based extraction; the pipeline validates the result in code.
    return extractByRules(message.fromAddr, category, cleanedBody);
  }

  async draftReplyBody(
    extracted: Record<string, unknown>,
    matchResult: MatchResult,
    _emailDate: string
  ): Promise<string> {
    return mockDraft(extracted, matchResult);
  }
}
