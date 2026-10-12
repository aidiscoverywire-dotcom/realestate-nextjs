import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createTenant } from "@/lib/tenants";

export async function GET() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      displayName: true,
      mailbox: true,
      domainPack: true,
      revoked: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ tenants });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { slug, displayName, mailbox, domainPack } = body;
  if (!slug || !displayName || !mailbox) {
    return NextResponse.json(
      { error: "slug, displayName and mailbox are required" },
      { status: 400 }
    );
  }
  const tenant = await createTenant({ slug, displayName, mailbox, domainPack });
  return NextResponse.json({ tenant }, { status: 201 });
}
