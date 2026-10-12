/**
 * Vault crypto. TypeScript port of vault/crypto.py.
 *
 * DELIBERATE DIFFERENCE: Python uses Fernet (AES-128-CBC + HMAC). Node's
 * stdlib has no Fernet, so this port uses AES-256-GCM via node:crypto.
 * Same contract: master key from VAULT_MASTER_KEY env only, encrypt returns
 * opaque bytes, decrypt is in-memory only, mask() for display.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKey(): Buffer {
  const raw = process.env.VAULT_MASTER_KEY;
  if (!raw) {
    throw new VaultError("VAULT_MASTER_KEY env var is not set");
  }
  // Accept a 64-char hex key (32 bytes). generateMasterKey() produces this.
  const buf = Buffer.from(raw.trim(), "hex");
  if (buf.length !== 32) {
    throw new VaultError(
      "VAULT_MASTER_KEY must be a 64-char hex string (32 bytes)"
    );
  }
  return buf;
}

/** Generate a fresh master key. Store it in VAULT_MASTER_KEY, never in repo. */
export function generateMasterKey(): string {
  return randomBytes(32).toString("hex");
}

export function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(ciphertext: Buffer): string {
  try {
    const iv = ciphertext.subarray(0, IV_LEN);
    const tag = ciphertext.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = ciphertext.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new VaultError("cannot decrypt: wrong master key or corrupt data");
  }
}

/** Last-4 masked form for inventory display. Never log the full value. */
export function mask(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}
