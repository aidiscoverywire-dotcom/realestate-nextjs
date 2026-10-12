import { Suspense } from "react";
import { prisma } from "@/lib/db/client";
import { PageFallback, StatusBadge, TenantPicker, resolveTenantId } from "../components";
import { revalidatePath } from "next/cache";

async function setReview(
  tenantId: string,
  draftId: string,
  reviewStatus: "approved" | "rejected"
) {
  "use server";
  await prisma.draft.updateMany({
    where: { id: draftId, tenantId },
    data: { reviewStatus },
  });
  revalidatePath("/drafts");
}

async function DraftsContent({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  const activeId = await resolveTenantId(tenantId);
  const drafts = activeId
    ? await prisma.draft.findMany({
        where: { tenantId: activeId },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Drafts</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Human review queue. The agent drafts; a human approves, then sends
            from Gmail. Nothing here is ever sent automatically.
          </p>
        </div>
        <TenantPicker activeId={activeId} basePath="/drafts" />
      </div>
      <div className="space-y-4">
        {drafts.map((d) => (
          <div
            key={d.id}
            className="rounded border border-zinc-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">{d.subject}</div>
                <div className="text-sm text-zinc-600">To: {d.to}</div>
              </div>
              <StatusBadge status={d.reviewStatus} />
            </div>
            {d.internalNote && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-medium">Internal note (delete before sending)</div>
                <pre className="mt-1 whitespace-pre-wrap font-sans">
                  {d.internalNote}
                </pre>
              </div>
            )}
            <pre className="mt-3 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-sm">
              {d.body}
            </pre>
            {d.flags.length > 0 && (
              <div className="mt-2 text-xs text-zinc-500">
                Flags: {d.flags.join(", ")}
              </div>
            )}
            {d.reviewStatus === "pending" && (
              <div className="mt-3 flex gap-2">
                <form
                  action={setReview.bind(null, activeId || "", d.id, "approved")}
                >
                  <button
                    type="submit"
                    className="rounded bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700"
                  >
                    Approve
                  </button>
                </form>
                <form
                  action={setReview.bind(null, activeId || "", d.id, "rejected")}
                >
                  <button
                    type="submit"
                    className="rounded border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100"
                  >
                    Reject
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
        {drafts.length === 0 && (
          <div className="rounded border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
            No drafts yet.
          </div>
        )}
      </div>
    </div>
  );
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback />}>
      <DraftsContent searchParams={searchParams} />
    </Suspense>
  );
}
