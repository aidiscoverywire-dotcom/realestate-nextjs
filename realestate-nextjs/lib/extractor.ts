/**
 * Structured extraction: validation plus the rule-based extractor used by
 * the mock client and tests.
 *
 * Production extraction comes from the LLM (RealGeminiClient); the
 * pipeline always runs the result through validateFields() here, in code,
 * before anything else touches it. Field validators are ported from
 * agent/schemas.py; the rule-based extractor mirrors what the Python mock
 * model client did for tests (regex over the cleaned body).
 */

import {
  canonicalPhone,
  isValidEmail,
  parseIsoDate,
  parseNumber,
  parsePrice,
  STAGES,
  type Category,
} from "./domain/realEstate";

/** Per-category allowed fields (ported from the pack's category_fields). */
export const CATEGORY_FIELDS: Record<Category, string[]> = {
  lead: [
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "price_budget",
    "beds",
    "baths",
    "viewing_date",
    "properties",
    "notes",
  ],
  contract_update: [
    "address",
    "deal_stage",
    "price",
    "appraisal_value",
    "closing_date",
    "counterparty",
    "properties",
    "notes",
  ],
  rental_inquiry: [
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "rent_budget",
    "move_in_date",
    "lease_term_months",
    "properties",
    "notes",
  ],
  noise: ["notes"],
};

const FIELD_VALIDATORS: Record<string, (v: unknown) => unknown> = {
  contact_email: (v) => (isValidEmail(v) ? String(v).trim() : null),
  contact_phone: (v) => (v ? canonicalPhone(v) : null),
  price_budget: parsePrice,
  price: parsePrice,
  appraisal_value: parsePrice,
  rent_budget: parsePrice,
  viewing_date: parseIsoDate,
  closing_date: parseIsoDate,
  move_in_date: parseIsoDate,
  beds: parseNumber,
  baths: parseNumber,
  lease_term_months: (v) => {
    const n = parseNumber(v);
    return n === null ? null : Math.trunc(n);
  },
};

function validateString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Validate and normalize extracted fields in code (port of
 * validate_fields). Pack-driven: only the category's allowed fields are
 * kept; unknown fields are dropped with a warning. Invalid fields become
 * null with a warning; a record is never rejected outright for one bad
 * field. deal_stage falls back to "unknown", never guessed.
 */
export function validateFields(
  category: Category,
  raw: Record<string, unknown>
): { extracted: Record<string, unknown>; warnings: string[] } {
  const allowedFields = CATEGORY_FIELDS[category];
  if (!allowedFields) {
    return {
      extracted: { notes: "" },
      warnings: [`unknown category '${category}'`],
    };
  }
  const allowed = new Set([...allowedFields, "properties"]);
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};

  for (const key of allowedFields) {
    const value = raw[key];
    if (key === "deal_stage") {
      const stage =
        typeof value === "string" && value.trim() ? value.trim() : "unknown";
      const recognized = (STAGES as readonly string[]).includes(stage);
      out[key] = recognized ? stage : "unknown";
      if (value && !recognized) {
        warnings.push(`unknown stage ${JSON.stringify(value)} -> 'unknown'`);
      }
      continue;
    }
    if (key === "notes") {
      out[key] = value == null ? "" : String(value);
      continue;
    }
    if (key === "properties") continue; // validated below
    const validator = FIELD_VALIDATORS[key] || validateString;
    let validated: unknown;
    try {
      validated = validator(value);
    } catch {
      validated = null;
    }
    out[key] = validated;
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      validated === null
    ) {
      warnings.push(`invalid value for ${key}`);
    }
  }

  // Multi-property array: max 3 entries, each {address, price}.
  const props = raw.properties;
  if (Array.isArray(props) && props.length > 0) {
    out.properties = props.slice(0, 3).map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        address:
          typeof e.address === "string" && e.address.trim()
            ? e.address.trim()
            : null,
        price: parsePrice(e.price),
      };
    });
  } else {
    out.properties = null;
  }

  const dropped = Object.keys(raw).filter((k) => !allowed.has(k));
  if (dropped.length > 0) {
    warnings.push(`dropped unknown fields: ${dropped.join(", ")}`);
  }
  return { extracted: out, warnings };
}

// ---------------------------------------------------------------------------
// Rule-based extractor (mock/dev): regex over the cleaned body
// ---------------------------------------------------------------------------

const PHONE_RE = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/;
const PRICE_RE = /\$([\d,]+)/;
const ADDRESS_RE =
  /(\d+\s+[A-Za-z0-9 .'-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Court|Ct|Place|Pl)\.?)/i;
const NAME_RE =
  /(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;

/**
 * Deterministic field extraction for tests/dev. Finds contact name, phone,
 * address, and one dollar amount (mapped to price_budget / price /
 * rent_budget by category). The pipeline still runs the output through
 * validateFields(); contact_email falls back to the From header there.
 */
export function extractByRules(
  fromAddr: string,
  category: Category,
  cleanedBody: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { notes: "" };
  const phoneM = PHONE_RE.exec(cleanedBody);
  if (phoneM) out.contact_phone = `${phoneM[1]}${phoneM[2]}${phoneM[3]}`;
  const priceM = PRICE_RE.exec(cleanedBody);
  if (priceM) {
    const val = parseInt(priceM[1].replace(/,/g, ""), 10);
    if (category === "rental_inquiry") out.rent_budget = val;
    else if (category === "contract_update") out.price = val;
    else out.price_budget = val;
  }
  const addrM = ADDRESS_RE.exec(cleanedBody);
  if (addrM) out.address = addrM[1].trim();
  const nameM = NAME_RE.exec(cleanedBody);
  if (nameM) out.contact_name = nameM[1];
  out.contact_email = fromAddr;
  if (category === "contract_update") out.deal_stage = "unknown";
  return out;
}
