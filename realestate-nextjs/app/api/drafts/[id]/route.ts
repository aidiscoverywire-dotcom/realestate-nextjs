import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

/**
 * PATCH /api/drafts/[id]: human oversight, approve or reject a draft.
 * The agent never sends; a human reviews here, then sends from Gmail.
 * Tenant-scoped: the update only applies to a draft owned by tenantId.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { reviewStatus, tenantId } = body;
  if (!["approved", "rejected"].includes(reviewStatus)) {
    return NextResponse.json(
      { error: "reviewStatus must be approved or rejected" },
      { status: 400 }
    );
  }
  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId required" },
      { status: 400 }
    );
  }
  const updated = await prisma.draft.updateMany({
    where: { id, tenantId },
    data: { reviewStatus },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const draft = await prisma.draft.findUnique({ where: { id } });
  return NextResponse.json({ draft });
}
