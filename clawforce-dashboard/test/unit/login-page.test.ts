import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural tests for the login page.
 *
 * The login page is a React Server Component with server actions,
 * which cannot be imported in Vitest without full Next.js context.
 * These tests verify the file structure and content patterns.
 */

const loginPagePath = resolve(
  import.meta.dirname,
  "../../src/app/login/page.tsx",
);

describe("login page", () => {
  const source = readFileSync(loginPagePath, "utf8");

  it("exports a default async function", () => {
    expect(source).toMatch(/export default async function/);
  });

  it("contains username input field", () => {
    expect(source).toContain('name="username"');
    expect(source).toContain('id="username"');
  });

  it("contains password input field", () => {
    expect(source).toContain('name="password"');
    expect(source).toContain('type="password"');
  });

  it("contains submit button", () => {
    expect(source).toContain('type="submit"');
    expect(source).toContain("Sign in");
  });

  it("has error display for failed credentials", () => {
    expect(source).toContain("error");
    expect(source).toContain("Invalid credentials");
  });

  it("uses signIn from auth module", () => {
    expect(source).toContain('signIn("credentials"');
  });

  it("redirects authenticated users to home", () => {
    expect(source).toContain('redirect("/")');
  });

  it("uses server action for form submission", () => {
    expect(source).toContain('"use server"');
  });
});
