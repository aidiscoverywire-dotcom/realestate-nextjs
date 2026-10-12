/**
 * Tenant scoping: every record in this system belongs to exactly one
 * tenant, and every query carries the tenant id. This module is the single
 * place that rule is enforced.
 *
 * Ported from tenants/config.py (tenant registry) and tenants/cli.py
 * (kill-switch ordering: revoke first, then wipe, then delete config).
 */

import { prisma, assertTenantActive } from "./db/client";
import { vaultStore } from "./vault/store";

export { assertTenantActive };

/** The where-clause fragment every tenant-scoped query must include. */
export function tenantScope(tenantId: string): { tenantId: string } {
  if (!tenantId) throw new Error("tenantId is required for tenant scoping");
  return { tenantId };
}

export interface TenantInput {
  slug: string;
  displayName: string;
  mailbox: string;
  domainPack?: string;
}

/** Create a tenant record. Secrets are never part of this payload; they
 *  live in the vault, keyed by tenant. OAuth consent is roadmap. */
export async function createTenant(input: TenantInput) {
  return prisma.tenant.create({
    data: {
      slug: input.slug,
      displayName: input.displayName,
      mailbox: input.mailbox,
      domainPack: input.domainPack || "real_estate",
    },
  });
}

/** Return the tenant only if it exists and is not revoked. */
export async function requireActiveTenant(tenantId: string) {
  await assertTenantActive(tenantId);
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

/**
 * Kill-switch: revoke the tenant (fail closed) and wipe its vault key
 * material, then delete the tenant record. One tenant's kill-switch never
 * touches another tenant's rows (every delete is tenantId-scoped).
 */
export async function killSwitchTenant(tenantId: string): Promise<{
  tenantId: string;
  revoked: boolean;
  secretsWiped: number;
  deleted: boolean;
}> {
  const result = await vaultStore.killSwitch(tenantId);
  await prisma.tenant.delete({ where: { id: tenantId } });
  return { ...result, deleted: true };
}
