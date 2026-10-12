/**
 * Per-tenant encrypted secret store. TypeScript port of vault/key_service.py.
 *
 * Secrets are encrypted with the master key (AES-256-GCM) and stored in the
 * VaultSecret table, keyed by (tenantId, key). Plaintext exists only in
 * memory. Supports rotation and the kill-switch (revoke + wipe).
 */
import { prisma } from "../db/client";
import { decrypt, encrypt, mask, VaultError } from "./crypto";

export class VaultStore {
  /** Store (or overwrite) a tenant secret. */
  async put(tenantId: string, key: string, plaintext: string): Promise<void> {
    const ciphertext = encrypt(plaintext).toString("base64");
    await prisma.vaultSecret.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { ciphertext },
      create: { tenantId, key, ciphertext },
    });
  }

  /** Read a tenant secret (decrypted, in-memory only). */
  async get(tenantId: string, key: string): Promise<string> {
    const row = await prisma.vaultSecret.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!row) throw new VaultError(`no secret ${key} for tenant ${tenantId}`);
    return decrypt(Buffer.from(row.ciphertext, "base64"));
  }

  /** Rotate = overwrite with the new value. */
  async rotate(
    tenantId: string,
    key: string,
    newPlaintext: string
  ): Promise<void> {
    await this.put(tenantId, key, newPlaintext);
  }

  /** Inventory: key names + masked values, never plaintext. */
  async list(tenantId: string): Promise<Array<{ key: string; masked: string }>> {
    const rows = await prisma.vaultSecret.findMany({
      where: { tenantId },
      select: { key: true },
    });
    // Masked display requires decrypting; do it row by row in memory.
    const out: Array<{ key: string; masked: string }> = [];
    for (const r of rows) {
      const full = await prisma.vaultSecret.findUnique({
        where: { tenantId_key: { tenantId, key: r.key } },
      });
      out.push({
        key: r.key,
        masked: full
          ? mask(decrypt(Buffer.from(full.ciphertext, "base64")))
          : "****",
      });
    }
    return out;
  }

  /**
   * Kill-switch: revoke the tenant (fail closed) and wipe its key material.
   * In production the OAuth token should be revoked at Google first via the
   * stored refresh token before wiping (see README roadmap).
   */
  async killSwitch(tenantId: string): Promise<{
    tenantId: string;
    revoked: boolean;
    secretsWiped: number;
  }> {
    const wiped = await prisma.vaultSecret.deleteMany({
      where: { tenantId },
    });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { revoked: true },
    });
    return { tenantId, revoked: true, secretsWiped: wiped.count };
  }
}

export const vaultStore = new VaultStore();
