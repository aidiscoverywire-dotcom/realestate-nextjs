/**
 * Real-estate domain pack. TypeScript port of domains/real_estate/pack.py.
 *
 * All domain behavior lives here: categories, prompts, extraction schemas,
 * matching rules, flags, record builders. The pipeline core in
 * lib/pipeline/driver.ts is domain-free and consumes this pack.
 */

export type Category = "lead" | "contract_update" | "rental_inquiry" | "noise";

export const CATEGORIES: Category[] = [
  "lead",
  "contract_update",
  "rental_inquiry",
  "noise",
];
export const NOISE_CATEGORY: Category = "noise";

export const STAGES = [
  "new",
  "contacted",
  "viewing",
  "offer",
  "under_contract",
  "inspection",
  "appraisal",
  "escrow",
  "closing",
  "closed",
  "terminated",
  "dead",
  "unknown",
] as const;

export const GENERIC_FLAGS = [
  "human_review",
  "has_attachments",
  "body_truncated",
  "data_conflict",
] as const;

export const PACK_FLAGS = [
  ...GENERIC_FLAGS,
  "returning_lead",
  "price_conflict",
  "appraisal_gap",
  "missing_address",
  "address_ambiguous",
  "missing_sheet_price",
  "unit_unconfirmed",
  "multi_property",
] as const;

export type Flag = (typeof PACK_FLAGS)[number];

/** Flags that force human_review even above the confidence threshold. */
export const HALT_FLAGS: Flag[] = ["address_ambiguous", "missing_address"];

/** Flags that appear in the internal-note block. */
export const BLOCK_FLAGS: Flag[] = [
  "price_conflict",
  "appraisal_gap",
  "data_conflict",
  "missing_sheet_price",
  "address_ambiguous",
  "missing_address",
];

export const CONFIDENCE_THRESHOLD = 0.7;
export const PRICE_CONFLICT_THRESHOLD = 0.02;

// ---------------------------------------------------------------------------
// Address-matching primitives (ported from pack.py)
// ---------------------------------------------------------------------------

const ABBREV: Record<string, string> = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  dr: "drive",
  rd: "road",
  ln: "lane",
  ct: "court",
  pl: "place",
  pkwy: "parkway",
  trl: "trail",
  cir: "circle",
  ste: "suite",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

const UNIT_RE =
  /(?:\b(?:apt|apartment|unit|suite|ste)\b\.?|#)\s*([a-z0-9][a-z0-9-]*)/i;

const CITY_ZIP_RE =
  /,\s*([A-Za-z][A-Za-z .'-]*?)\s*,?\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/;

const ASKING_PRICE_PHRASES = [
  "listed at",
  "listed for",
  "listing",
  "asking price",
  "advertised",
];

export function looksLikeAskingPrice(cleanedBody: string): boolean {
  const low = (cleanedBody || "").toLowerCase();
  return ASKING_PRICE_PHRASES.some((p) => low.includes(p));
}

function parseAddress(addr: string): {
  house: string;
  street: Set<string>;
  unit: string | null;
} {
  let text = addr.trim().toLowerCase();
  let unit: string | null = null;
  const m = UNIT_RE.exec(text);
  if (m) {
    unit = m[1].toLowerCase();
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  }
  const tokens: string[] = text.match(/[a-z0-9]+/g) || [];
  let house = "";
  let rest = tokens;
  if (tokens.length > 0 && /^\d+$/.test(tokens[0])) {
    house = tokens[0];
    rest = tokens.slice(1);
  }
  const street = new Set(rest.map((t) => ABBREV[t] || t));
  return { house, street, unit };
}

function cityZip(addr: string): [string | null, string | null] {
  const m = CITY_ZIP_RE.exec(addr.trim());
  if (!m) return [null, null];
  return [m[1].trim(), m[3]];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type AddressStrength = "exact" | "fuzzy" | "ambiguous" | "none";

export interface PropertyRow {
  property_id?: string;
  address?: string;
  city?: string;
  zip?: string;
  price?: string | number | null;
  unit?: string;
  status?: string;
}

export function matchAddress(
  emailAddr: string,
  prop: PropertyRow
): { strength: AddressStrength; extraFlags: Flag[] } {
  const e = parseAddress(emailAddr);
  const s = parseAddress(prop.address || "");
  const unitS = (prop.unit || "").trim().toLowerCase() || s.unit;
  // 1. House-number gate (required, exact as digits).
  if (!e.house || !s.house) return { strength: "none", extraFlags: [] };
  if (parseInt(e.house, 10) !== parseInt(s.house, 10))
    return { strength: "none", extraFlags: [] };
  // 2. Street-name match: token Jaccard >= 0.8. Substring containment is
  //    forbidden; matching is always token-based.
  const j = jaccard(e.street, s.street);
  if (j < 0.8) return { strength: "none", extraFlags: [] };
  // 3. Unit numbers: exact when both present.
  const extraFlags: Flag[] = [];
  if (e.unit && unitS) {
    if (e.unit !== unitS) return { strength: "none", extraFlags: [] };
  } else if (e.unit || unitS) {
    extraFlags.push("unit_unconfirmed");
  }
  // 4. City/ZIP role.
  const [cityE, zipE] = cityZip(emailAddr);
  const cityS = prop.city;
  const zipS = prop.zip;
  const streetExact = j === 1.0;
  const comparable = cityE && zipE && cityS && zipS;
  if (comparable) {
    if (
      (cityE || "").toLowerCase() === (cityS || "").toLowerCase() &&
      zipE === zipS
    ) {
      return { strength: "exact", extraFlags };
    }
    return { strength: "ambiguous", extraFlags };
  }
  return { strength: streetExact ? "exact" : "fuzzy", extraFlags };
}

// ---------------------------------------------------------------------------
// Field validators (ported from agent/schemas.py)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/** Canonical phone form (NANPA rules): strip non-digits; 11 digits starting
 *  with 1 drops to 10. Null when fewer than 7 digits. */
export function canonicalPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 7) return null;
  return digits;
}

/** Whole dollars, price > 0. Accepts ints and numeric strings. */
export function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  let ivalue: number;
  if (typeof value === "number") {
    ivalue = Math.trunc(value);
  } else if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "").replace(/\$/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    ivalue = Math.trunc(parseFloat(cleaned));
  } else {
    return null;
  }
  return ivalue > 0 ? ivalue : null;
}

export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const d = new Date(text);
  if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  // Named formats: "Oct 15 2026", "October 15, 2026", "10/15/2026"
  const parsed = Date.parse(text);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompts (verbatim from pack.py)
// ---------------------------------------------------------------------------

export const CLASSIFIER_PROMPT = `You classify real-estate operations emails into exactly one category.
Definitions:
- lead: someone wants to BUY: viewing requests, offers, buyer questions,
  investor inquiries, pre-approvals, relocation buyers.
- contract_update: an EXISTING deal moves: signed contracts, addenda,
  inspection/appraisal/escrow/closing updates, terminations. Often from
  agents, title companies, lenders, inspectors.
- rental_inquiry: RENTING/LEASING: availability, applications, renewals,
  tenant questions, move-in dates, roommates.
- noise: mail with NO actionable real-estate content: newsletters,
  promos, auto-replies, system notifications. (If the mail is vague or
  ambiguous but MIGHT be actionable, it is NOT noise; give it the best
  category and a LOW confidence score.)

RULES:
1. If the email is vague or could be two categories, pick the dominant one
   and say so in \`rationale\`, and LOWER your confidence honestly.
2. Confidence is your calibrated uncertainty, 0 to 1. Below 0.7 the email goes
   to a human; never inflate to avoid that.
3. Return JSON only, matching the schema exactly.`;

export const EXTRACTOR_PROMPT_TEMPLATE = `Extract the fields in the schema from this {category} email. The email was
sent on {emailDate}; resolve relative dates ("Oct 15", "next Friday")
against that date.
RULES:
1. Copy values EXACTLY as written (normalize phones to digits, dates to
   ISO). Never invent a value that isn't in the email; use null.
2. If two values conflict in the cleaned body, put the FIRST mention in
   the field (the newest content is at the top; quoted history was
   removed) and note both in \`notes\`.
3. Prices are whole dollars, no commas or symbols. Rents are monthly.
4. For \`deal_stage\`, use only the allowed enum; if unclear, use "unknown"
   , never guess.
5. If the email discusses MORE THAN ONE property, put the first/primary
   one in the top-level fields and list the rest (up to 3) in
   \`properties\` as {"address", "price"} entries.
6. Return JSON only, matching the schema exactly.`;

export const DRAFTER_PROMPT = `You draft a reply for a real-estate operations team. You are professional,
warm, and concise, like a good leasing agent, not a robot.

CONTEXT you will receive: the VALIDATED EXTRACTED FIELDS, the
cross-reference result (returning lead? known property? price conflict?),
and the email's date. You will NOT receive the raw email; work only from
these fields.

RULES:
1. Internal review notes (conflict flags, sheet discrepancies) live in the
   system log, NOT in your text. You write ONLY the customer-facing reply.
   Never mention internal flags, sheet discrepancies, or uncertainty in
   your text; write as if the data you were given is correct.
2. Reference real data only: the sheet price, the requested viewing date,
   the lead's recorded history. Never invent availability, prices,
   appointment times, or history. If the email named a date but no time,
   do NOT invent a time; ask what times work.
3. Keep the customer-facing text under 150 words. End with one clear next
   step.
4. This is a DRAFT for human review; write it so the agent can send it
   with one click or a quick edit (after deleting the internal block).
5. Never commit to terms ("we accept $X", "you're approved"); propose,
   don't promise.`;

// ---------------------------------------------------------------------------
// Cross-reference (ported from pack.py::RealEstatePack.match)
// ---------------------------------------------------------------------------

export interface LeadRow {
  lead_id?: string;
  name?: string;
  email?: string;
  phone_canonical?: string;
  interest_address?: string;
  budget?: string | number | null;
}

export interface MatchResult {
  contactMatches: Array<{
    leadId: string;
    matchedOn: string;
    strength: string;
  }>;
  entityMatches: Array<{
    propertyId: string;
    address: string;
    sheetPrice: number | null;
    status: string;
    strength: AddressStrength;
  }>;
  conflicts: Array<{ type: string; detail: string }>;
  flags: Flag[];
}

export interface CrossRefSettings {
  priceConflictThreshold?: number;
}

export function crossReference(
  extracted: Record<string, unknown>,
  category: Category,
  referenceRows: { contacts: LeadRow[]; entities: PropertyRow[] },
  settings: CrossRefSettings = {},
  cleanedBody = ""
): MatchResult {
  const askingPriceFramed = looksLikeAskingPrice(cleanedBody);
  const flags: Flag[] = [];
  const contactMatches: MatchResult["contactMatches"] = [];
  const entityMatches: MatchResult["entityMatches"] = [];
  const conflicts: MatchResult["conflicts"] = [];
  const ambiguousAddresses: string[] = [];

  // Returning-lead detection (email or canonical phone).
  const email = String(extracted.contact_email || "")
    .trim()
    .toLowerCase();
  const phone = String(extracted.contact_phone || "");
  for (const lead of referenceRows.contacts) {
    let matchedOn: string | null = null;
    if (email && (lead.email || "").toLowerCase() === email) {
      matchedOn = "email";
    } else if (phone && (lead.phone_canonical || "") === phone) {
      matchedOn = "phone";
    }
    if (matchedOn) {
      contactMatches.push({
        leadId: lead.lead_id || "",
        matchedOn,
        strength: "exact",
      });
    }
  }
  if (contactMatches.length > 0) flags.push("returning_lead");

  // Property matching.
  const address = String(extracted.address || "").trim();
  if (address) {
    for (const prop of referenceRows.entities) {
      const { strength, extraFlags } = matchAddress(address, prop);
      if (strength === "exact" || strength === "fuzzy") {
        entityMatches.push({
          propertyId: prop.property_id || "",
          address: prop.address || "",
          sheetPrice: parsePrice(prop.price),
          status: prop.status || "",
          strength,
        });
        flags.push(...extraFlags);
      } else if (strength === "ambiguous") {
        ambiguousAddresses.push(prop.property_id || "");
      }
    }
    if (ambiguousAddresses.length > 0 && entityMatches.length === 0) {
      flags.push("address_ambiguous");
    }
  } else if (category === "contract_update") {
    flags.push("missing_address");
  }

  // Price comparison (like-for-like ONLY).
  let priceMatches = entityMatches;
  if (entityMatches.length > 1) {
    flags.push("address_ambiguous");
    priceMatches = [];
  }
  const threshold = settings.priceConflictThreshold ?? PRICE_CONFLICT_THRESHOLD;
  if (category === "contract_update") {
    const emailPrice = parsePrice(extracted.price);
    if (priceMatches.length > 0) {
      const sheetPrice = priceMatches[0].sheetPrice;
      if (emailPrice && sheetPrice) {
        const diff = Math.abs(emailPrice - sheetPrice) / sheetPrice;
        if (diff > threshold) {
          const pct = `${(diff * 100).toFixed(1)}%`;
          conflicts.push({
            type: "price_conflict",
            detail: `email quotes $${emailPrice.toLocaleString()}; sheet lists $${sheetPrice.toLocaleString()} (${pct} difference)`,
          });
          flags.push("price_conflict");
        }
      } else if (emailPrice && !sheetPrice) {
        flags.push("missing_sheet_price");
      }
    }
    const appraisal = parsePrice(extracted.appraisal_value);
    const price = parsePrice(extracted.price);
    if (appraisal && price && appraisal < price) {
      const gap = (price - appraisal) / price;
      if (gap > threshold) {
        conflicts.push({
          type: "appraisal_gap",
          detail: `appraisal $${appraisal.toLocaleString()} is below contract price $${price.toLocaleString()} (${(gap * 100).toFixed(1)}% gap)`,
        });
        flags.push("appraisal_gap");
      }
    }
  } else if (category === "lead" && askingPriceFramed) {
    const budget = parsePrice(extracted.price_budget);
    if (budget && priceMatches.length > 0) {
      const sheetPrice = priceMatches[0].sheetPrice;
      if (sheetPrice) {
        const diff = Math.abs(budget - sheetPrice) / sheetPrice;
        if (diff > threshold) {
          const pct = `${(diff * 100).toFixed(1)}%`;
          conflicts.push({
            type: "price_conflict",
            detail: `buyer quotes $${budget.toLocaleString()} as the asking price; sheet lists $${sheetPrice.toLocaleString()} (${pct} difference)`,
          });
          flags.push("price_conflict");
        }
      }
    }
  }

  // Attachment / truncation / multi-property / data-conflict flags.
  if (extracted.has_attachments) flags.push("has_attachments");
  if (extracted.body_truncated) flags.push("body_truncated");
  const props = extracted.properties;
  if (Array.isArray(props) && props.length > 1) flags.push("multi_property");
  if (extracted.data_conflict) flags.push("data_conflict");

  // Dedupe flags, preserve order.
  const seen = new Set<Flag>();
  const deduped = flags.filter((f) => {
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });

  return {
    contactMatches,
    entityMatches,
    conflicts,
    flags: deduped,
  };
}

// ---------------------------------------------------------------------------
// Internal block (ported from pack.py::render_internal_block)
// ---------------------------------------------------------------------------

const FLAG_NOTES: Partial<Record<Flag, string>> = {
  missing_address:
    "no property address found in the email; please identify the property before sending.",
  address_ambiguous:
    "the address matched ambiguously against our sheets; please verify the property before sending.",
  missing_sheet_price:
    "the sheet has no price for this property; please verify pricing before sending.",
  data_conflict:
    "the email states two different dollar amounts for the price; please confirm the correct one before sending.",
};

export function renderInternalBlock(matchResult: MatchResult): string {
  const relevant = matchResult.conflicts.filter((c) =>
    (BLOCK_FLAGS as string[]).includes(c.type)
  );
  const extra = matchResult.flags
    .map((f) => FLAG_NOTES[f])
    .filter((n): n is string => !!n);
  if (relevant.length === 0 && extra.length === 0) return "";
  const lines = ["⛔ INTERNAL NOTE - DELETE BEFORE SENDING:"];
  for (const conflict of relevant) {
    lines.push(`- ${conflict.detail} Please confirm before sending.`);
  }
  for (const note of extra) {
    lines.push(`- ${note}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Mock draft (ported from pack.py::mock_draft, tests/dev only)
// ---------------------------------------------------------------------------

export function mockDraft(
  extracted: Record<string, unknown>,
  matchResult: MatchResult
): string {
  const name = String(extracted.contact_name || "there");
  const first = name.trim() ? name.trim().split(/\s+/)[0] : "there";
  const address = String(extracted.address || "the property");
  const flags = matchResult.flags;
  const lines = [
    `Hi ${first},`,
    "",
    `Thanks for reaching out about ${address}.`,
  ];
  if (extracted.viewing_date) {
    lines.push(
      `We can arrange a viewing around ${extracted.viewing_date}; let me know what times work for you.`
    );
  }
  if (extracted.move_in_date) {
    lines.push(
      `Regarding your ${extracted.move_in_date} move-in target, I'll check availability and next steps.`
    );
  }
  if (flags.includes("returning_lead")) {
    lines.push("Great to hear from you again.");
  }
  lines.push("", "I'll follow up shortly with the details.", "", "Best regards");
  return lines.join("\n");
}

const NON_PRICE_CONTEXT_RE =
  /(deposit|down\s*pay|earnest|security\s*dep)/i;

/**
 * Two or more DISTINCT dollar amounts in the body → the email contradicts
 * itself on price. Normalizes k/m suffixes ($450k == $450,000) and ignores
 * amounts in deposit/down-payment context. Ported from
 * domains/base.py::DomainPack.detect_data_conflict.
 */
export function detectDataConflict(cleanedBody: string): boolean {
  const amounts = new Set<number>();
  const re = /\$(\d[\d,]*)\s*([kKmM])?/g;
  const body = cleanedBody || "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const context = body.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20);
    if (NON_PRICE_CONTEXT_RE.test(context)) continue;
    let val = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(val)) continue;
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k") val *= 1000;
    else if (suffix === "m") val *= 1000000;
    amounts.add(val);
  }
  return amounts.size >= 2;
}

/** Try counterparty → Leads sheet → interest_address fallback. Mutates
 *  extracted in place; returns true when the address was filled. */
export function tryResolveReference(  extracted: Record<string, unknown>,
  category: Category,
  lookupContacts: () => LeadRow[]
): boolean {
  if (category !== "contract_update" || extracted.address) return false;
  const counterparty = String(extracted.counterparty || "").trim();
  if (!counterparty) return false;
  const cpTokens = new Set(
    (counterparty.toLowerCase().match(/[a-z0-9]+/g) || [])
  );
  if (cpTokens.size === 0) return false;
  for (const lead of lookupContacts()) {
    const nameTokens = new Set(
      (String(lead.name || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    );
    const subset = [...cpTokens].every((t) => nameTokens.has(t));
    if (subset) {
      const addr = String(lead.interest_address || "").trim();
      if (addr) {
        extracted.address = addr;
        extracted.address_source = "contacts_sheet";
        return true;
      }
    }
  }
  return false;
}
