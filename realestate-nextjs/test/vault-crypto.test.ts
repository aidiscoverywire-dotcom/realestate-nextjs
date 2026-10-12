import { describe, expect, it, beforeEach } from "vitest";
import {
  decrypt,
  encrypt,
  generateMasterKey,
  mask,
  VaultError,
} from "@/lib/vault/crypto";

describe("vault crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.VAULT_MASTER_KEY = generateMasterKey();
  });

  it("round-trips plaintext", () => {
    const ct = encrypt("sk-gemini-secret-123");
    expect(decrypt(ct)).toBe("sk-gemini-secret-123");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("fails closed on the wrong master key", () => {
    const ct = encrypt("secret");
    process.env.VAULT_MASTER_KEY = generateMasterKey();
    expect(() => decrypt(ct)).toThrow(VaultError);
  });

  it("fails closed on tampered ciphertext", () => {
    const ct = encrypt("secret");
    ct[ct.length - 1] ^= 0xff;
    expect(() => decrypt(ct)).toThrow(VaultError);
  });

  it("requires VAULT_MASTER_KEY to be set", () => {
    delete process.env.VAULT_MASTER_KEY;
    expect(() => encrypt("x")).toThrow(VaultError);
  });

  it("rejects a malformed master key", () => {
    process.env.VAULT_MASTER_KEY = "not-hex";
    expect(() => encrypt("x")).toThrow(VaultError);
  });

  it("mask() never reveals the full value", () => {
    const m = mask("sk-gemini-secret-123");
    expect(m).not.toContain("gemini-secret-123");
    expect(m.endsWith("-123")).toBe(true);
    expect(mask("short")).toBe("****");
  });

  it("generateMasterKey produces a 64-char hex key", () => {
    const k = generateMasterKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
