import { describe, expect, it } from "vitest";
import { classifyByKeywords } from "@/lib/classifier";
import type { Category } from "@/lib/domain/realEstate";

/**
 * Fixture-based accuracy for the rule-based classifier (lib/classifier.ts).
 * These fixtures mirror the pack's category definitions: lead (wants to
 * buy), contract_update (an existing deal moves), rental_inquiry
 * (renting/leasing), noise (no actionable real-estate content).
 *
 * Honest scope: this measures the deterministic keyword port, not LLM
 * accuracy. Real model accuracy is an M1-style exercise on the tenant's
 * own mail (see README).
 */
const FIXTURES: Array<{ body: string; label: Category }> = [
  // --- lead ---
  {
    body: "Hi, my name is Sarah Mitchell. I am interested in viewing 1428 Elm Street. My budget is around $485,000. Please call me at (512) 555-0147.",
    label: "lead",
  },
  {
    body: "We are relocating to Austin next month and looking for a 3 bed home near Zilker. Are you the listing agent?",
    label: "lead",
  },
  {
    body: "I would like to submit an offer on the property at 2100 E 7th Street. I am pre-approved for $620,000.",
    label: "lead",
  },
  {
    body: "Can we schedule a visit this Saturday to tour the duplex on Congress Ave?",
    label: "lead",
  },
  // --- contract_update ---
  {
    body: "The addendum for 2100 E 7th Street has been executed. Closing moved from Nov 8 to Nov 22.",
    label: "contract_update",
  },
  {
    body: "Inspection report is back on 1428 Elm Street. The buyer requests repairs to the roof before we proceed to closing.",
    label: "contract_update",
  },
  {
    body: "This is First Title. The escrow instructions are signed and the appraisal came in at $472,000.",
    label: "contract_update",
  },
  {
    body: "Termination notice: the buyer is exercising the option period and terminating the contract for 9 Elm Rd.",
    label: "contract_update",
  },
  // --- rental_inquiry ---
  {
    body: "Is 301 Congress Ave Apt 4B ($2,200/mo) still available? I am looking to move in on Nov 1.",
    label: "rental_inquiry",
  },
  {
    body: "Hi, I am a tenant at 88 Rainey St and my lease renews in December. Can I renew at the same rent?",
    label: "rental_inquiry",
  },
  {
    body: "Do you allow roommates? I want to apply for the 2 bedroom unit and split the lease with a friend.",
    label: "rental_inquiry",
  },
  {
    body: "I submitted a rental application yesterday. When will the landlord review it?",
    label: "rental_inquiry",
  },
  // --- noise ---
  {
    body: "This week's market newsletter: mortgage rate trends, staging tips, and three new listings across the metro.",
    label: "noise",
  },
  {
    body: "SALE: 20% off all moving and storage services this weekend only. Unsubscribe to stop receiving these emails.",
    label: "noise",
  },
  {
    body: "This is an automated out-of-office reply. I will be back on Monday and will respond then.",
    label: "noise",
  },
  {
    body: "Your password was changed successfully. If this was not you, contact support immediately.",
    label: "noise",
  },
];

describe("rule-based classifier accuracy (fixtures)", () => {
  it("labels every fixture correctly", () => {
    const misses: string[] = [];
    for (const f of FIXTURES) {
      const got = classifyByKeywords(f.body);
      if (got.category !== f.label) {
        misses.push(`expected ${f.label}, got ${got.category}: ${f.body.slice(0, 60)}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("reports accuracy explicitly", () => {
    const correct = FIXTURES.filter(
      (f) => classifyByKeywords(f.body).category === f.label
    ).length;
    const accuracy = correct / FIXTURES.length;
    expect(accuracy).toBe(1);
  });

  it("gives ambiguous mail low confidence (below the 0.7 human-review gate)", () => {
    // "offer" is a lead hint, but alone it is weak: the classifier should
    // not be confident. The pipeline routes this to a human.
    const r = classifyByKeywords("We need to offer our help with the move.");
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("prefers contract_update when both contract and rental hints appear", () => {
    // Dominant-category rule from the pack: mixed mail picks the winner.
    const r = classifyByKeywords(
      "The lease addendum was signed; closing is next week. The tenant will vacate before the appraisal."
    );
    expect(r.category).toBe("contract_update");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
