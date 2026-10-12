import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { killSwitchTenant } from "@/lib/tenants";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ tenant });
}

/**
 * DELETE = kill-switch first, then config delete (ported from
 * tenants/cli.py remove). Revokes the tenant (fail closed) and wipes its
 * vault key material.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await killSwitchTenant(id);
  return NextResponse.json(result);
}
