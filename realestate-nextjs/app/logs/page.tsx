import { Suspense } from "react";
import { prisma } from "@/lib/db/client";
import { CategoryBadge, PageFallback, StatusBadge, TenantPicker, resolveTenantId } from "../components";

async function LogsContent({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; status?: string }>;
}) {
  const { tenantId, status } = await searchParams;
  const activeId = await resolveTenantId(tenantId);
  const logs = activeId
    ? await prisma.logEntry.findMany({
        where: { tenantId: activeId, ...(status ? { status } : {}) },
        orderBy: { timestamp: "desc" },
        take: 200,
      })
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
        <TenantPicker activeId={activeId} basePath="/logs" />
      </div>
      <p className="mb-4 text-sm text-zinc-600">
        Append-only pipeline log. One row per processed email, traceable to
        its source message ID.
      </p>
      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase text-zinc-500">
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">Message</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2">Flags</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-zinc-600">
                  {l.timestamp.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="max-w-[140px] truncate px-4 py-2 font-mono text-xs">
                  {l.messageId}
                </td>
                <td className="px-4 py-2">
                  <CategoryBadge category={l.category} />
                </td>
                <td className="px-4 py-2">{l.contactName || l.contactEmail || "-"}</td>
                <td className="max-w-[200px] truncate px-4 py-2">{l.address || "-"}</td>
                <td className="max-w-[200px] truncate px-4 py-2 text-xs text-zinc-600">
                  {l.flags.join(", ") || "-"}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={l.status} />
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No log entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback />}>
      <LogsContent searchParams={searchParams} />
    </Suspense>
  );
}
