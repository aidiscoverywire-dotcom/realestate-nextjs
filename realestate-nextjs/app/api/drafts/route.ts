import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  const reviewStatus = request.nextUrl.searchParams.get("reviewStatus");
  const drafts = await prisma.draft.findMany({
    where: { tenantId, ...(reviewStatus ? { reviewStatus } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ drafts });
}
