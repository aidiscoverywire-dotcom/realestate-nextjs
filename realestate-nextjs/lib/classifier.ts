/**
 * Rule-based domain-pack classifier for the real_estate pack.
 *
 * Production classification comes from the LLM (RealGeminiClient in
 * lib/llm/client.ts, using the pack prompts). This module is the
 * deterministic keyword/rule-based port used by the mock client and the
 * accuracy test fixtures: the same code path the Python test suite
 * exercised with MockModelClient.
 *
 * Categories: lead | contract_update | rental_inquiry | noise.
 */

import type { Category } from "./domain/realEstate";

export interface RuleClassification {
  category: Category;
  confidence: number;
  rationale: string;
}

const LEAD_HINTS = [
  "viewing",
  "interested",
  "buying",
  "offer",
  "tour",
  "schedule a visit",
  "looking for",
  "pre-approved",
  "relocation",
];

const CONTRACT_HINTS = [
  "contract",
  "addendum",
  "inspection",
  "appraisal",
  "escrow",
  "closing",
  "signed",
  "terminate",
  "termination",
  "title company",
  "executed",
  "addenda",
];

const RENTAL_HINTS = [
  "rent",
  "lease",
  "rental",
  "tenant",
  "move-in",
  "move in",
  "application",
  "landlord",
  "roommate",
];

function scoreHints(text: string, hints: string[]): number {
  // Word-boundary matching (plural/verb suffixes allowed): a raw
  // substring test would match "lease" inside "please" or "rent" inside
  // "different", which is exactly the substring trap the pack's address
  // matcher forbids. Keyword matching is token-based here too.
  return hints.filter((h) => {
    const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}(s|es|ed|ing)?\\b`).test(text);
  }).length;
}

/**
 * Classify a cleaned email body by keyword dominance. Ties resolve in
 * pack order (lead, contract_update, rental_inquiry). No hint at all is
 * noise: newsletters, promos, auto-replies carry none of the pack
 * vocabulary. Ambiguous mail (a single weak hint) gets low confidence so
 * the pipeline routes it to human review.
 */
export function classifyByKeywords(cleanedBody: string): RuleClassification {
  const low = (cleanedBody || "").toLowerCase();
  const lead = scoreHints(low, LEAD_HINTS);
  const contract = scoreHints(low, CONTRACT_HINTS);
  const rental = scoreHints(low, RENTAL_HINTS);
  const total = lead + contract + rental;

  if (total === 0) {
    return {
      category: "noise",
      confidence: 0.9,
      rationale: "rule-based: no pack vocabulary matched",
    };
  }
  if (lead >= contract && lead >= rental) {
    return {
      category: "lead",
      confidence: confidenceFor(lead, total),
      rationale: "rule-based: lead hints dominant",
    };
  }
  if (contract >= rental) {
    return {
      category: "contract_update",
      confidence: confidenceFor(contract, total),
      rationale: "rule-based: contract hints dominant",
    };
  }
  return {
    category: "rental_inquiry",
    confidence: confidenceFor(rental, total),
    rationale: "rule-based: rental hints dominant",
  };
}

/** Calibrated-ish confidence: a single hint is weak (0.6, below the 0.7
 *  gate, so ambiguous mail goes to a human); dominant multi-hint mail
 *  scores 0.85. */
function confidenceFor(winner: number, total: number): number {
  if (winner <= 1) return 0.6;
  if (winner === total) return 0.9;
  return 0.85;
}
