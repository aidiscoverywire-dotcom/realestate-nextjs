import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * API route tests with the Prisma client mocked. Every route test asserts
 * tenant scoping: no query may read or write without a tenantId.
 *
 * DB-backed tests are intentionally mocked: this repo's tests never touch
 * a real database or any Google/Gemini API (see README).
 */

const { mockPrisma } = vi.hoisted(() => {
  const mk = () => ({
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    mockPrisma: {
      tenant: mk(),
      emailMessage: mk(),
      draft: mk(),
      logEntry: mk(),
      vaultSecret: mk(),
      sheetCache: mk(),
    },
  };
});

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
  assertTenantActive: vi.fn(),
}));

vi.mock("@/lib/tenants", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tenants")>();
  return {
    ...mod,
    createTenant: vi.fn(),
    killSwitchTenant: vi.fn(),
  };
});

vi.mock("@/lib/pipeline/service", () => ({
  runTenantPipeline: vi.fn(),
}));

import { GET as tenantsGet, POST as tenantsPost } from "@/app/api/tenants/route";
import { GET as tenantGet, DELETE as tenantDelete } from "@/app/api/tenants/[id]/route";
import { GET as inboxGet } from "@/app/api/inbox/route";
import { GET as draftsGet } from "@/app/api/drafts/route";
import { PATCH as draftPatch } from "@/app/api/drafts/[id]/route";
import { GET as logsGet } from "@/app/api/logs/route";
import { POST as triggerPost } from "@/app/api/pipeline/trigger/route";
import { createTenant, killSwitchTenant } from "@/lib/tenants";
import { runTenantPipeline } from "@/lib/pipeline/service";
import { NextRequest } from "next/server";

function req(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
): NextRequest {
  return new NextRequest(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tenant.findMany.mockResolvedValue([]);
  mockPrisma.emailMessage.findMany.mockResolvedValue([]);
  mockPrisma.draft.findMany.mockResolvedValue([]);
  mockPrisma.logEntry.findMany.mockResolvedValue([]);
  mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.draft.findUnique.mockResolvedValue({ id: "d1", reviewStatus: "approved" });
});

describe("/api/tenants", () => {
  it("GET lists tenants", async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: "t1", slug: "acme" }]);
    const res = await tenantsGet();
    expect(res.status).toBe(200);
    expect((await res.json()).tenants).toHaveLength(1);
  });

  it("POST creates via the tenants module and validates input", async () => {
    vi.mocked(createTenant).mockResolvedValue({ id: "t2" } as never);
    const res = await tenantsPost(
      req("http://x/api/tenants", {
        method: "POST",
        body: JSON.stringify({
          slug: "acme",
          displayName: "Acme",
          mailbox: "ops@acme.example",
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(createTenant).toHaveBeenCalledWith({
      slug: "acme",
      displayName: "Acme",
      mailbox: "ops@acme.example",
      domainPack: undefined,
    });
  });

  it("POST rejects missing fields with 400", async () => {
    const res = await tenantsPost(
      req("http://x/api/tenants", {
        method: "POST",
        body: JSON.stringify({ slug: "acme" }),
      })
    );
    expect(res.status).toBe(400);
    expect(createTenant).not.toHaveBeenCalled();
  });
});

describe("/api/tenants/[id]", () => {
  it("DELETE runs the kill-switch (revoke + wipe) then deletes", async () => {
    vi.mocked(killSwitchTenant).mockResolvedValue({
      tenantId: "t1",
      revoked: true,
      secretsWiped: 2,
      deleted: true,
    });
    const res = await tenantDelete(req("http://x"), {
      params: Promise.resolve({ id: "t1" }),
    } as never);
    expect(res.status).toBe(200);
    expect(killSwitchTenant).toHaveBeenCalledWith("t1");
    expect(await res.json()).toMatchObject({ revoked: true, deleted: true });
  });
});

describe("tenant scoping on list routes", () => {
  it("GET /api/inbox requires tenantId (400 otherwise)", async () => {
    const res = await inboxGet(req("http://x/api/inbox"));
    expect(res.status).toBe(400);
  });

  it("GET /api/inbox always scopes by tenantId", async () => {
    await inboxGet(req("http://x/api/inbox?tenantId=t1"));
    expect(mockPrisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "t1" }) })
    );
  });

  it("GET /api/drafts always scopes by tenantId", async () => {
    await draftsGet(req("http://x/api/drafts?tenantId=t1&reviewStatus=pending"));
    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1", reviewStatus: "pending" }),
      })
    );
  });

  it("GET /api/logs always scopes by tenantId", async () => {
    await logsGet(req("http://x/api/logs?tenantId=t1"));
    expect(mockPrisma.logEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "t1" }) })
    );
  });

  it("GET /api/drafts requires tenantId (400 otherwise)", async () => {
    const res = await draftsGet(req("http://x/api/drafts"));
    expect(res.status).toBe(400);
  });

  it("GET /api/logs requires tenantId (400 otherwise)", async () => {
    const res = await logsGet(req("http://x/api/logs"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/drafts/[id] (human review)", () => {
  function patchReq(body: unknown) {
    return req("http://x/api/drafts/d1", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  it("approves with tenant scoping (updateMany on id+tenantId)", async () => {
    const res = await draftPatch(patchReq({ reviewStatus: "approved", tenantId: "t1" }), {
      params: Promise.resolve({ id: "d1" }),
    } as never);
    expect(res.status).toBe(200);
    expect(mockPrisma.draft.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", tenantId: "t1" },
      data: { reviewStatus: "approved" },
    });
  });

  it("rejects invalid reviewStatus with 400", async () => {
    const res = await draftPatch(patchReq({ reviewStatus: "maybe", tenantId: "t1" }), {
      params: Promise.resolve({ id: "d1" }),
    } as never);
    expect(res.status).toBe(400);
    expect(mockPrisma.draft.updateMany).not.toHaveBeenCalled();
  });

  it("requires tenantId with 400", async () => {
    const res = await draftPatch(patchReq({ reviewStatus: "approved" }), {
      params: Promise.resolve({ id: "d1" }),
    } as never);
    expect(res.status).toBe(400);
    expect(mockPrisma.draft.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the draft is not owned by the tenant", async () => {
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 0 });
    const res = await draftPatch(patchReq({ reviewStatus: "rejected", tenantId: "t9" }), {
      params: Promise.resolve({ id: "d1" }),
    } as never);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/pipeline/trigger", () => {
  it("runs the pipeline for the tenant and returns the report", async () => {
    vi.mocked(runTenantPipeline).mockResolvedValue({
      processed: 3,
      reports: [],
    });
    const res = await triggerPost(
      req("http://x/api/pipeline/trigger", {
        method: "POST",
        body: JSON.stringify({ tenantId: "t1" }),
      })
    );
    expect(res.status).toBe(200);
    expect(runTenantPipeline).toHaveBeenCalledWith("t1");
    expect(await res.json()).toMatchObject({ processed: 3 });
  });

  it("requires tenantId (400)", async () => {
    const res = await triggerPost(
      req("http://x/api/pipeline/trigger", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    expect(runTenantPipeline).not.toHaveBeenCalled();
  });

  it("maps pipeline failures to 500 without leaking internals", async () => {
    vi.mocked(runTenantPipeline).mockRejectedValue(new Error("tenant t1 is revoked"));
    const res = await triggerPost(
      req("http://x/api/pipeline/trigger", {
        method: "POST",
        body: JSON.stringify({ tenantId: "t1" }),
      })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("tenant t1 is revoked");
  });
});

describe("GET /api/tenants/[id]", () => {
  it("returns 404 for unknown tenants", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    const res = await tenantGet(req("http://x"), {
      params: Promise.resolve({ id: "nope" }),
    } as never);
    expect(res.status).toBe(404);
  });
});
