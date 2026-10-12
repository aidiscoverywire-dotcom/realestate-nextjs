import { prisma } from "@/lib/db/client";
import Link from "next/link";

export function PageFallback() {
  return (
    <div className="rounded border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
      Loading...
    </div>
  );
}

export async function TenantPicker({
  activeId,
  basePath,
}: {
  activeId: string | null;
  basePath: string;
}) {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true },
  });
  if (tenants.length === 0) return null;
  return (
    <div className="flex gap-1">
      {tenants.map((t) => (
        <Link
          key={t.id}
          href={`${basePath}?tenantId=${t.id}`}
          className={`rounded px-3 py-1.5 text-sm ${
            t.id === activeId
              ? "bg-zinc-900 text-white"
              : "bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200"
          }`}
        >
          {t.displayName}
        </Link>
      ))}
    </div>
  );
}

export async function resolveTenantId(
  param: string | undefined
): Promise<string | null> {
  if (param) {
    const t = await prisma.tenant.findUnique({
      where: { id: param },
      select: { id: true },
    });
    if (t) return t.id;
  }
  const first = await prisma.tenant.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id || null;
}

const CATEGORY_STYLES: Record<string, string> = {
  lead: "bg-green-100 text-green-800",
  contract_update: "bg-blue-100 text-blue-800",
  rental_inquiry: "bg-purple-100 text-purple-800",
  noise: "bg-zinc-100 text-zinc-500",
};

export function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] || "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {category || "-"}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  processed: "bg-green-100 text-green-800",
  human_review: "bg-amber-100 text-amber-800",
  noise_logged: "bg-zinc-100 text-zinc-500",
  draft_failed: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
  dead_letter: "bg-red-100 text-red-800",
  queued: "bg-zinc-100 text-zinc-600",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-zinc-100 text-zinc-600",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {status}
    </span>
  );
}
