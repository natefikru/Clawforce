import { describe, it, expect } from "vitest";

/**
 * Middleware logic tests.
 *
 * The actual middleware.ts imports from next-auth which depends on next/server,
 * making it impossible to import directly in Vitest. Instead, we test the
 * decision logic extracted as a pure function.
 */

interface MiddlewareRequest {
  pathname: string;
  auth: { user: { role?: string } } | null;
  authSecret: string | undefined;
}

type MiddlewareResult =
  | { action: "pass" }
  | { action: "redirect"; to: string }
  | { action: "json"; status: number; body: { error: string } };

function middlewareDecision(req: MiddlewareRequest): MiddlewareResult {
  const { pathname, auth, authSecret } = req;

  // Auth not configured — open dashboard
  if (!authSecret) return { action: "pass" };

  // Public routes
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return { action: "pass" };
  }

  // Not authenticated
  if (!auth) {
    if (pathname.startsWith("/api/")) {
      return {
        action: "json",
        status: 401,
        body: { error: "unauthorized" },
      };
    }
    return { action: "redirect", to: "/login" };
  }

  return { action: "pass" };
}

describe("middleware decision logic", () => {
  const secret = "test-secret-32-chars-long-enough";

  it("passes through when AUTH_SECRET absent (open dashboard)", () => {
    const result = middlewareDecision({
      pathname: "/",
      auth: null,
      authSecret: undefined,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("passes through authenticated requests", () => {
    const result = middlewareDecision({
      pathname: "/",
      auth: { user: { role: "admin" } },
      authSecret: secret,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("redirects unauthenticated page requests to /login", () => {
    const result = middlewareDecision({
      pathname: "/",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({ action: "redirect", to: "/login" });
  });

  it("returns 401 for unauthenticated API requests", () => {
    const result = middlewareDecision({
      pathname: "/api/activity",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({
      action: "json",
      status: 401,
      body: { error: "unauthorized" },
    });
  });

  it("returns 401 for unauthenticated SSE stream", () => {
    const result = middlewareDecision({
      pathname: "/api/activity/stream",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({
      action: "json",
      status: 401,
      body: { error: "unauthorized" },
    });
  });

  it("always passes /login route", () => {
    const result = middlewareDecision({
      pathname: "/login",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("always passes /api/auth/* routes", () => {
    const result = middlewareDecision({
      pathname: "/api/auth/callback/credentials",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("always passes /api/auth/signin", () => {
    const result = middlewareDecision({
      pathname: "/api/auth/signin",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("passes authenticated API requests", () => {
    const result = middlewareDecision({
      pathname: "/api/status",
      auth: { user: { role: "viewer" } },
      authSecret: secret,
    });
    expect(result).toEqual({ action: "pass" });
  });

  it("redirects unauthenticated nested page routes", () => {
    const result = middlewareDecision({
      pathname: "/settings",
      auth: null,
      authSecret: secret,
    });
    expect(result).toEqual({ action: "redirect", to: "/login" });
  });
});
