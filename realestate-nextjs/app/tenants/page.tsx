import { Suspense } from "react";
import { prisma } from "@/lib/db/client";
import { revalidatePath } from "next/cache";
import { PageFallback } from "../components";

async function createTenant(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug") || "").trim();
  const displayName = String(formData.get("displayName") || "").trim();
  const mailbox = String(formData.get("mailbox") || "").trim();
  if (!slug || !displayName || !mailbox) return;
  await prisma.tenant.create({
    data: { slug, displayName, mailbox, domainPack: "real_estate" },
  });
  revalidatePath("/tenants");
}

async function TenantsContent() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Tenants</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {tenants.map((t) => (
          <div
            key={t.id}
            className="rounded border border-zinc-200 bg-white p-5"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{t.displayName}</div>
              {t.revoked ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  revoked
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  active
                </span>
              )}
            </div>
            <div className="mt-2 text-sm text-zinc-600">
              <div>Slug: <code className="rounded bg-zinc-100 px-1">{t.slug}</code></div>
              <div>Mailbox: {t.mailbox}</div>
              <div>Pack: {t.domainPack}</div>
              <div>Confidence threshold: {t.confidenceThreshold}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded border border-zinc-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Onboard a tenant</h2>
        <form action={createTenant} className="grid gap-3 md:grid-cols-4">
          <input
            name="slug"
            placeholder="acme-realty"
            required
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <input
            name="displayName"
            placeholder="Acme Realty"
            required
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <input
            name="mailbox"
            placeholder="ops-agent@acme.example"
            required
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700"
          >
            Create
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          Secrets (Gemini key, Google OAuth tokens) are stored encrypted in the
          vault per tenant, never in this form. OAuth consent flow is roadmap.
        </p>
      </div>
    </div>
  );
}

export default async function TenantsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <TenantsContent />
    </Suspense>
  );
}
