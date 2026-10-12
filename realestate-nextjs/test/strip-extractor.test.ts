import { describe, expect, it } from "vitest";
import {
  resolveRecipient,
  safeConfidence,
  stripQuotedHistory,
} from "@/lib/pipeline/strip";

describe("stripQuotedHistory", () => {
  it("drops >-quoted lines", () => {
    const body = "Hello\n> quoted line\nWorld";
    expect(stripQuotedHistory(body)).toBe("Hello\nWorld");
  });

  it("cuts at On...wrote: headers", () => {
    const body = "New text\nOn Mon, Oct 5, 2026 at 3:45 PM John wrote:\nOld text";
    expect(stripQuotedHistory(body)).toBe("New text");
  });

  it("cuts at ---Original Message---", () => {
    const body = "Fresh\n---Original Message---\nHistory";
    expect(stripQuotedHistory(body)).toBe("Fresh");
  });

  it("keeps forwarded payload but skips its headers", () => {
    const body =
      "See below\n---Forwarded message---\nFrom: a@b.com\nSubject: hi\n\nPayload here";
    const out = stripQuotedHistory(body);
    expect(out).toContain("Payload here");
    expect(out).not.toContain("From: a@b.com");
  });
});

describe("resolveRecipient", () => {
  it("uses From by default", () => {
    expect(resolveRecipient({ fromAddr: "a@x.com" })).toBe("a@x.com");
  });

  it("prefers Reply-To only on matching domains", () => {
    expect(
      resolveRecipient({ fromAddr: "a@x.com", replyTo: "b@x.com" })
    ).toBe("b@x.com");
    // Attacker domain in Reply-To must never win.
    expect(
      resolveRecipient({ fromAddr: "a@x.com", replyTo: "evil@attacker.com" })
    ).toBe("a@x.com");
  });
});

describe("safeConfidence", () => {
  it("clamps into [0,1]", () => {
    expect(safeConfidence(0.85)).toBe(0.85);
    expect(safeConfidence(1.5)).toBe(1);
    expect(safeConfidence(-0.2)).toBe(0);
  });
  it("maps NaN/inf/garbage to 0.0", () => {
    expect(safeConfidence(NaN)).toBe(0.0);
    expect(safeConfidence(Infinity)).toBe(0.0);
    expect(safeConfidence("high")).toBe(0.0);
    expect(safeConfidence(85)).toBe(1); // raw score clamped, never trusted raw
  });
});
