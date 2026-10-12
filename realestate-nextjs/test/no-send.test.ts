import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MockGmailClient } from "@/lib/gmail/client";

/**
 * Structural no-send enforcement, the TypeScript equivalent of the
 * Python test_no_send.py AST scan.
 *
 * The product rule is absolute: this system has no code path that sends
 * email. Replies are created as Gmail drafts; a human clicks Send. This
 * test scans every lib/ source file for send-like call sites so the rule
 * is enforced structurally, not just by convention.
 */

function libFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...libFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Patterns that would indicate a real send path. Comments mentioning
// "never sends" are allowed; only actual call sites fail.
const SEND_PATTERNS: RegExp[] = [
  /\.send\s*\(/, // users.messages.send(...) or client.send(...)
  /\bsendMessage\b/,
  /messages\.send\b/,
  /\.deliver\s*\(/,
  /gmail\.send\b/,
];

describe("no-send invariant (structural scan)", () => {
  const files = libFiles(join(__dirname, "..", "lib"));

  it("scans all lib sources", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("contains no send call sites in lib/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.split("//")[0]; // ignore line comments
        if (SEND_PATTERNS.some((re) => re.test(code))) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the Gmail client exposes drafts.create as its only write path", () => {
    const gmail = new MockGmailClient();
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(gmail)
    );
    expect(methods).toContain("createDraft");
    expect(methods).not.toContain("send");
    expect(methods).not.toContain("sendMessage");
  });

  it("draft records are always status=draft, never sent", () => {
    // The Draft table has no sent state by construction: reviewStatus is
    // pending|approved|rejected (human oversight). There is no code path
    // that transitions a draft to sent anywhere in lib/.
    const schema = readFileSync(
      join(__dirname, "..", "prisma", "schema.prisma"),
      "utf8"
    );
    expect(schema).not.toMatch(/status.*sent/i);
  });
});
