import { NextRequest, NextResponse } from "next/server";
import { runTenantPipeline } from "@/lib/pipeline/service";

/**
 * POST /api/pipeline/trigger: run one pipeline poll for a tenant.
 * Body: { tenantId }. In production this would be a cron; here it is an
 * explicit trigger (human-initiated, auditable).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tenantId } = body;
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }
  try {
    const result = await runTenantPipeline(tenantId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
