import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  const status = request.nextUrl.searchParams.get("status");
  const logs = await prisma.logEntry.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  return NextResponse.json({ logs });
}
