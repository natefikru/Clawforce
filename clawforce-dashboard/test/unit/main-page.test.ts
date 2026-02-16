import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural tests for the main dashboard page.
 *
 * The page is a React Server Component with server actions,
 * which cannot be imported in Vitest without full Next.js context.
 */

const mainPagePath = resolve(import.meta.dirname, "../../src/app/page.tsx");

describe("main dashboard page", () => {
  const source = readFileSync(mainPagePath, "utf8");

  it("imports auth for session checking", () => {
    expect(source).toContain("import { auth");
  });

  it("imports signOut for logout functionality", () => {
    expect(source).toContain("signOut");
  });

  it("calls auth() to get session", () => {
    expect(source).toContain("await auth()");
  });

  it("displays user name when authenticated", () => {
    expect(source).toContain("session.user.name");
  });

  it("displays user role when available", () => {
    expect(source).toContain("role");
  });

  it("has a sign out form with server action", () => {
    expect(source).toContain("signOut");
    expect(source).toContain("Sign out");
    expect(source).toContain('"use server"');
  });

  it("conditionally renders session UI", () => {
    expect(source).toContain("session?.user");
  });

  it("preserves original dashboard components", () => {
    expect(source).toContain("AgentStatusCard");
    expect(source).toContain("CostTracker");
    expect(source).toContain("ActivityFeed");
    expect(source).toContain("TaskLog");
  });
});
