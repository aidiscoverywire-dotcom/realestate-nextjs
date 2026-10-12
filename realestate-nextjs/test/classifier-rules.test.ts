import { describe, expect, it } from "vitest";
import {
  canonicalPhone,
  crossReference,
  detectDataConflict,
  looksLikeAskingPrice,
  matchAddress,
  mockDraft,
  parsePrice,
  renderInternalBlock,
  tryResolveReference,
  type MatchResult,
} from "@/lib/domain/realEstate";

describe("canonicalPhone (NANPA)", () => {
  it("strips formatting and the +1 country code", () => {
    expect(canonicalPhone("+1 (415) 555-0132")).toBe("4155550132");
    expect(canonicalPhone("415-555-0132")).toBe("4155550132");
  });
  it("returns null for too-short input", () => {
    expect(canonicalPhone("123")).toBe(null);
    expect(canonicalPhone("")).toBe(null);
    expect(canonicalPhone(123 as unknown as string)).toBe(null);
  });
});

describe("parsePrice", () => {
  it("parses whole dollars", () => {
    expect(parsePrice("$425,000")).toBe(425000);
    expect(parsePrice("425000")).toBe(425000);
    expect(parsePrice(425000)).toBe(425000);
  });
  it("rejects non-positive and non-numeric", () => {
    expect(parsePrice(0)).toBe(null);
    expect(parsePrice(-5)).toBe(null);
    expect(parsePrice("abc")).toBe(null);
    expect(parsePrice(null)).toBe(null);
  });
});

describe("looksLikeAskingPrice", () => {
  it("detects listing-price framing", () => {
    expect(looksLikeAskingPrice("the home is listed at $500k")).toBe(true);
    expect(looksLikeAskingPrice("asking price is $500,000")).toBe(true);
  });
  it("does not fire on pure budgets", () => {
    expect(looksLikeAskingPrice("my budget is $400k")).toBe(false);
  });
});

describe("matchAddress", () => {
  const prop = {
    property_id: "p1",
    address: "123 Oak Street",
    city: "Austin",
    zip: "78701",
    price: "450000",
  };

  it("exact match with abbreviation expansion", () => {
    const r = matchAddress("123 Oak St", prop);
    expect(r.strength).toBe("exact");
  });

  it("rejects on house-number mismatch (gate)", () => {
    const r = matchAddress("124 Oak St", prop);
    expect(r.strength).toBe("none");
  });

  it("rejects substring containment (token-based only)", () => {
    const r = matchAddress("123 Oak Street Westside", prop);
    expect(r.strength).toBe("none");
  });

  it("fuzzy match when street tokens mostly overlap", () => {
    // 4 shared of 5 union tokens = 0.8 >= gate, but not street-exact.
    const r = matchAddress("123 North West Oak Street", {
      property_id: "p2",
      address: "123 North West Oak Street Boulevard",
    });
    expect(r.strength).toBe("fuzzy");
  });

  it("rejects on unit mismatch when both present", () => {
    const r = matchAddress("123 Oak St Apt 4", {
      ...prop,
      unit: "5",
    });
    expect(r.strength).toBe("none");
  });

  it("adds unit_unconfirmed when only one side has a unit", () => {
    const r = matchAddress("123 Oak St Apt 4", prop);
    expect(r.strength).toBe("exact");
    expect(r.extraFlags).toContain("unit_unconfirmed");
  });

  it("expands directionals (N Oak Ave == North Oak Avenue)", () => {
    const r = matchAddress("456 N Oak Ave", {
      property_id: "p2",
      address: "456 North Oak Avenue",
    });
    expect(r.strength).toBe("exact");
  });
});

describe("crossReference", () => {
  const contacts = [
    {
      lead_id: "l1",
      name: "Jane Doe",
      email: "jane@example.com",
      phone_canonical: "4155550132",
      interest_address: "123 Oak Street",
    },
  ];
  const entities = [
    {
      property_id: "p1",
      address: "123 Oak Street",
      city: "Austin",
      zip: "78701",
      price: "450000",
      status: "active",
    },
  ];

  it("detects a returning lead by email", () => {
    const r = crossReference(
      { contact_email: "jane@example.com" },
      "lead",
      { contacts, entities }
    );
    expect(r.flags).toContain("returning_lead");
    expect(r.contactMatches[0].matchedOn).toBe("email");
  });

  it("detects a returning lead by canonical phone", () => {
    const r = crossReference(
      { contact_phone: "4155550132" },
      "lead",
      { contacts, entities }
    );
    expect(r.contactMatches[0].matchedOn).toBe("phone");
  });

  it("flags price_conflict on contract price vs sheet mismatch", () => {
    const r = crossReference(
      { address: "123 Oak St", price: 500000 },
      "contract_update",
      { contacts: [], entities }
    );
    expect(r.flags).toContain("price_conflict");
    expect(r.conflicts[0].type).toBe("price_conflict");
  });

  it("flags address_ambiguous when two properties match", () => {
    const twoProps = [
      ...entities,
      {
        property_id: "p2",
        address: "123 Oak Street",
        city: "Austin",
        zip: "78701",
        price: "460000",
        status: "active",
      },
    ];
    const r = crossReference(
      { address: "123 Oak St", price: 500000 },
      "contract_update",
      { contacts: [], entities: twoProps }
    );
    expect(r.flags).toContain("address_ambiguous");
    // With ambiguity, no price is compared against an arbitrary pick.
    expect(r.conflicts.filter((c) => c.type === "price_conflict")).toEqual([]);
  });

  it("never compares a pure budget to the listing price", () => {
    const r = crossReference(
      { address: "123 Oak St", price_budget: 400000 },
      "lead",
      { contacts: [], entities },
      {},
      "my budget is $400k"
    );
    expect(r.flags).not.toContain("price_conflict");
  });

  it("compares when the lead quotes the asking price", () => {
    const r = crossReference(
      { address: "123 Oak St", price_budget: 500000 },
      "lead",
      { contacts: [], entities },
      {},
      "the home is listed at $500,000"
    );
    expect(r.flags).toContain("price_conflict");
  });

  it("flags missing_address for contract_update without address", () => {
    const r = crossReference({ price: 500000 }, "contract_update", {
      contacts: [],
      entities,
    });
    expect(r.flags).toContain("missing_address");
  });

  it("flags appraisal_gap when appraisal is below contract price", () => {
    const r = crossReference(
      { address: "123 Oak St", price: 500000, appraisal_value: 450000 },
      "contract_update",
      { contacts: [], entities }
    );
    expect(r.flags).toContain("appraisal_gap");
  });

  it("dedupes flags preserving order", () => {
    const r = crossReference(
      { contact_email: "jane@example.com", contact_phone: "4155550132" },
      "lead",
      { contacts, entities }
    );
    const count = r.flags.filter((f) => f === "returning_lead").length;
    expect(count).toBe(1);
  });
});

describe("detectDataConflict", () => {
  it("fires on two distinct dollar amounts", () => {
    expect(detectDataConflict("Price is $500,000 but appraisal came at $450,000")).toBe(true);
  });
  it("ignores $450k vs $450,000 (same amount, k-normalized)", () => {
    expect(detectDataConflict("Listed at $450k, which is $450,000")).toBe(false);
  });
  it("ignores deposit context", () => {
    expect(detectDataConflict("Rent is $2000 plus $2000 security deposit")).toBe(false);
  });
  it("needs at least two amounts", () => {
    expect(detectDataConflict("Price is $500,000")).toBe(false);
  });
});

describe("renderInternalBlock", () => {
  it("renders conflict details with the delete-before-sending header", () => {
    const mr: MatchResult = {
      contactMatches: [],
      entityMatches: [],
      conflicts: [{ type: "price_conflict", detail: "email quotes $500,000" }],
      flags: ["price_conflict"],
    };
    const block = renderInternalBlock(mr);
    expect(block).toContain("DELETE BEFORE SENDING");
    expect(block).toContain("email quotes $500,000");
  });

  it("renders flag notes for missing_address", () => {
    const mr: MatchResult = {
      contactMatches: [],
      entityMatches: [],
      conflicts: [],
      flags: ["missing_address"],
    };
    expect(renderInternalBlock(mr)).toContain("no property address found");
  });

  it("returns empty string when there is nothing to flag", () => {
    const mr: MatchResult = {
      contactMatches: [],
      entityMatches: [],
      conflicts: [],
      flags: [],
    };
    expect(renderInternalBlock(mr)).toBe("");
  });
});

describe("tryResolveReference", () => {
  const leads = [
    { lead_id: "l1", name: "Carlos Alvarez", interest_address: "9 Elm Rd" },
  ];
  it("fills the address from a token-boundary counterparty match", () => {
    const extracted: Record<string, unknown> = { counterparty: "Carlos Alvarez" };
    const ok = tryResolveReference(extracted, "contract_update", () => leads);
    expect(ok).toBe(true);
    expect(extracted.address).toBe("9 Elm Rd");
  });
  it("does not substring-match (al in carlos alvarez must not fill)", () => {
    const extracted: Record<string, unknown> = { counterparty: "Al" };
    const ok = tryResolveReference(extracted, "contract_update", () => leads);
    expect(ok).toBe(false);
    expect(extracted.address).toBeUndefined();
  });
  it("is a no-op when the address is already present", () => {
    const extracted: Record<string, unknown> = {
      counterparty: "Carlos Alvarez",
      address: "1 Main St",
    };
    expect(tryResolveReference(extracted, "contract_update", () => leads)).toBe(false);
    expect(extracted.address).toBe("1 Main St");
  });
});

describe("mockDraft", () => {
  it("greets by first name and never invents times", () => {
    const text = mockDraft(
      { contact_name: "Jane Doe", address: "123 Oak St", viewing_date: "2026-10-20" },
      { contactMatches: [], entityMatches: [], conflicts: [], flags: [] }
    );
    expect(text).toContain("Hi Jane,");
    expect(text).toContain("2026-10-20");
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
