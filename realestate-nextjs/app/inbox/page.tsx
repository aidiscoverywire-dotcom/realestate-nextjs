import { Suspense } from "react";
import { prisma } from "@/lib/db/client";
import { CategoryBadge, PageFallback, StatusBadge, TenantPicker, resolveTenantId } from "../components";

async function InboxContent({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  const activeId = await resolveTenantId(tenantId);
  const emails = activeId
    ? await prisma.emailMessage.findMany({
        where: { tenantId: activeId },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <TenantPicker activeId={activeId} basePath="/inbox" />
      </div>
      <div className="overflow-hidden rounded border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase text-zinc-500">
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Confidence</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-2 font-medium">{e.subject || "(no subject)"}</td>
                <td className="px-4 py-2 text-zinc-600">{e.fromAddr}</td>
                <td className="px-4 py-2">
                  <CategoryBadge category={e.category} />
                </td>
                <td className="px-4 py-2 text-zinc-600">
                  {e.confidence ? e.confidence.toFixed(2) : "-"}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={e.status} />
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No emails yet. Trigger a pipeline run to process the inbox.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback />}>
      <InboxContent searchParams={searchParams} />
    </Suspense>
  );
}
