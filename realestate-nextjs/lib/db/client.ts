/**
 * Prisma client singleton + tenant-scoping helpers.
 *
 * Tenant isolation rule: every query MUST include tenantId. The helpers
 * below make that the path of least resistance; there is no code path
 * that reads cross-tenant rows.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Guard: refuse to operate on a revoked tenant (kill-switch, fail closed). */
export async function assertTenantActive(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { revoked: true },
  });
  if (!tenant) throw new Error(`unknown tenant ${tenantId}`);
  if (tenant.revoked) throw new Error(`tenant ${tenantId} is revoked`);
}
