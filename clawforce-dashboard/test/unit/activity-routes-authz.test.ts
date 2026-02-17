import { describe, it, expect, afterEach, vi } from "vitest";

describe("activity route authorization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/auth");
  });

  it("rejects non-admin agentId filter for /api/activity", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.doMock("@/auth", () => ({
      auth: async () => ({ user: { role: "viewer" } }),
    }));

    const { GET } = await import("@/app/api/activity/route");
    const res = await GET(new Request("http://localhost/api/activity?agentId=agent-a"));

    expect(res.status).toBe(403);
    const payload = await res.json() as { error: string };
    expect(payload.error).toBe("forbidden");
  });

  it("rejects non-admin agentId filter for /api/activity/stream", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.doMock("@/auth", () => ({
      auth: async () => ({ user: { role: "viewer" } }),
    }));

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/activity/stream/route");
    const req = new NextRequest("http://localhost/api/activity/stream?agentId=agent-a");
    const res = await GET(req);

    expect(res.status).toBe(403);
    const payload = await res.json() as { error: string };
    expect(payload.error).toBe("forbidden");
  });
});
