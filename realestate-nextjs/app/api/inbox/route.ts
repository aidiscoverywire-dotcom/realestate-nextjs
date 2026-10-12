import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  const status = request.nextUrl.searchParams.get("status");
  const emails = await prisma.emailMessage.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ emails });
}
