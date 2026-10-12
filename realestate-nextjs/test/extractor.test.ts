import { describe, expect, it } from "vitest";
import { extractByRules, validateFields } from "@/lib/extractor";

describe("extractByRules (rule-based extractor)", () => {
  it("extracts lead fields: name, phone, address, budget", () => {
    const out = extractByRules(
      "sarah.mitchell@email.com",
      "lead",
      "Hi, my name is Sarah Mitchell. I am interested in viewing 1428 Elm Street. My budget is $485,000. Call me at (512) 555-0147."
    );
    expect(out.contact_name).toBe("Sarah Mitchell");
    expect(out.contact_phone).toBe("5125550147");
    expect(out.address).toContain("1428 Elm Street");
    expect(out.price_budget).toBe(485000);
    expect(out.contact_email).toBe("sarah.mitchell@email.com");
  });

  it("maps the dollar amount to price for contract_update", () => {
    const out = extractByRules(
      "title@firsttitle.com",
      "contract_update",
      "The addendum for 2100 E 7th Street has been executed. Price $499,000."
    );
    expect(out.price).toBe(499000);
    expect(out.price_budget).toBeUndefined();
    expect(out.deal_stage).toBe("unknown");
  });

  it("maps the dollar amount to rent_budget for rental_inquiry", () => {
    const out = extractByRules(
      "jessica.tran@email.com",
      "rental_inquiry",
      "Is 301 Congress Ave Apt 4B ($2,200/mo) still available?"
    );
    expect(out.rent_budget).toBe(2200);
    expect(out.price_budget).toBeUndefined();
  });

  it("returns empty-ish output when nothing matches", () => {
    const out = extractByRules("x@y.com", "lead", "Just saying hello.");
    expect(out.contact_phone).toBeUndefined();
    expect(out.address).toBeUndefined();
    expect(out.price_budget).toBeUndefined();
  });
});

describe("validateFields (code-side validation)", () => {
  it("validates and normalizes a lead", () => {
    const { extracted, warnings } = validateFields("lead", {
      contact_name: " Jane Doe ",
      contact_email: "jane@example.com",
      contact_phone: "+1 (415) 555-0132",
      price_budget: "$425,000",
      beds: "3",
      notes: "",
    });
    expect(extracted.contact_name).toBe("Jane Doe");
    expect(extracted.contact_phone).toBe("4155550132");
    expect(extracted.price_budget).toBe(425000);
    expect(extracted.beds).toBe(3);
    expect(warnings).toEqual([]);
  });

  it("nulls invalid fields with a warning instead of rejecting the record", () => {
    const { extracted, warnings } = validateFields("lead", {
      contact_email: "not-an-email",
      price_budget: "lots",
      notes: "",
    });
    expect(extracted.contact_email).toBe(null);
    expect(extracted.price_budget).toBe(null);
    expect(warnings.length).toBe(2);
  });

  it("caps multi-property arrays at 3", () => {
    const props = [1, 2, 3, 4, 5].map((i) => ({
      address: `${i} Main St`,
      price: 100000 * i,
    }));
    const { extracted } = validateFields("lead", { properties: props, notes: "" });
    expect((extracted.properties as unknown[]).length).toBe(3);
  });

  it("defaults deal_stage to unknown", () => {
    const { extracted } = validateFields("contract_update", { notes: "" });
    expect(extracted.deal_stage).toBe("unknown");
  });

  it("drops unknown fields with a warning", () => {
    const { warnings } = validateFields("lead", {
      contact_name: "Jane",
      made_up_field: "x",
      notes: "",
    });
    expect(warnings.some((w) => w.includes("made_up_field"))).toBe(true);
  });
});
