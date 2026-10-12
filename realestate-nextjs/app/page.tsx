import { Suspense } from "react";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import { PageFallback } from "./components";

async function getStats(tenantId: string | null) {
  if (!tenantId) return null;
  const [emails, drafts, logs, tenants] = await Promise.all([
    prisma.emailMessage.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: true,
    }),
    prisma.draft.groupBy({
      by: ["reviewStatus"],
      where: { tenantId },
      _count: true,
    }),
    prisma.logEntry.count({ where: { tenantId } }),
    prisma.tenant.count(),
  ]);
  return { emails, drafts, logs, tenants };
}

async function OverviewContent({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, slug: true },
  });
  const activeId = tenantId || tenants[0]?.id || null;
  const stats = await getStats(activeId);

  const emailCounts: Record<string, number> = {};
  for (const e of stats?.emails || []) emailCounts[e.status] = e._count;
  const draftCounts: Record<string, number> = {};
  for (const d of stats?.drafts || []) draftCounts[d.reviewStatus] = d._count;

  const cards = [
    { label: "Processed", value: emailCounts.processed || 0 },
    { label: "Human review", value: emailCounts.human_review || 0 },
    { label: "Noise logged", value: emailCounts.noise_logged || 0 },
    { label: "Drafts pending", value: draftCounts.pending || 0 },
    { label: "Log entries", value: stats?.logs || 0 },
    { label: "Tenants", value: stats?.tenants || 0 },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        {tenants.length > 0 && (
          <div className="text-sm text-zinc-600">
            Tenant:{" "}
            <strong>
              {tenants.find((t) => t.id === activeId)?.displayName}
            </strong>
          </div>
        )}
      </div>

      {tenants.length === 0 && (
        <div className="rounded border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          No tenants yet. Create one via{" "}
          <code className="rounded bg-zinc-100 px-1">POST /api/tenants</code>{" "}
          or the Tenants page.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded border border-zinc-200 bg-white p-5"
          >
            <div className="text-3xl font-bold">{c.value}</div>
            <div className="mt-1 text-sm text-zinc-600">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Safety invariant:</strong> this system drafts replies only. It
        never sends email. Every draft waits in the{" "}
        <Link href="/drafts" className="underline">
          review queue
        </Link>{" "}
        for a human.
      </div>
    </div>
  );
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback />}>
      <OverviewContent searchParams={searchParams} />
    </Suspense>
  );
}
