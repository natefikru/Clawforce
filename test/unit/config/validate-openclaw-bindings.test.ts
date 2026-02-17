import { describe, it, expect } from "vitest";
import {
  validateBindings,
  OpenClawBindingsSchema,
} from "../../../src/config/validate-openclaw-bindings.js";

describe("validateBindings", () => {
  it("should accept valid bindings", () => {
    const bindings = [
      {
        agentId: "inbox-analyst",
        match: {
          channel: "discord",
          peer: { kind: "channel" as const, id: "111111111111111111" },
        },
      },
      {
        agentId: "research-agent",
        match: {
          channel: "discord",
          peer: { kind: "direct" as const, id: "222222222222222222" },
        },
      },
    ];
    expect(() => validateBindings(bindings)).not.toThrow();
  });

  it("should accept bindings with optional fields", () => {
    const bindings = [
      {
        agentId: "agent-a",
        match: {
          channel: "discord",
          accountId: "bot-account-1",
          guildId: "999999999999999999",
          roles: ["mod", "admin"],
        },
      },
    ];
    expect(() => validateBindings(bindings)).not.toThrow();
  });

  it("should reject missing match.channel", () => {
    const bindings = [
      {
        agentId: "agent-a",
        match: {
          peer: { kind: "channel", id: "111111111111111111" },
        },
      },
    ];
    expect(() => validateBindings(bindings)).toThrow(
      /Generated OpenClaw bindings are invalid/,
    );
  });

  it("should reject match.channel as array (the exact bug we fixed)", () => {
    const bindings = [
      {
        agentId: "agent-a",
        match: {
          channel: ["#inbox-triage"],
          peer: ["alice"],
        },
      },
    ];
    expect(() => validateBindings(bindings)).toThrow(
      /Generated OpenClaw bindings are invalid/,
    );
  });

  it("should reject invalid peer.kind", () => {
    const bindings = [
      {
        agentId: "agent-a",
        match: {
          channel: "discord",
          peer: { kind: "invalid-kind", id: "111111111111111111" },
        },
      },
    ];
    expect(() => validateBindings(bindings)).toThrow(
      /Generated OpenClaw bindings are invalid/,
    );
  });

  it("should accept undefined bindings (optional)", () => {
    expect(() => validateBindings(undefined)).not.toThrow();
  });

  it("should reject extra properties on match (strict mode)", () => {
    const bindings = [
      {
        agentId: "agent-a",
        match: {
          channel: "discord",
          unknownField: "value",
        },
      },
    ];
    expect(() => validateBindings(bindings)).toThrow(
      /Generated OpenClaw bindings are invalid/,
    );
  });
});

describe("OpenClawBindingsSchema", () => {
  it("should parse valid bindings array", () => {
    const result = OpenClawBindingsSchema.safeParse([
      {
        agentId: "test",
        match: { channel: "discord" },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("should accept dm as peer kind", () => {
    const result = OpenClawBindingsSchema.safeParse([
      {
        agentId: "test",
        match: {
          channel: "discord",
          peer: { kind: "dm", id: "123" },
        },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("should accept group as peer kind", () => {
    const result = OpenClawBindingsSchema.safeParse([
      {
        agentId: "test",
        match: {
          channel: "discord",
          peer: { kind: "group", id: "123" },
        },
      },
    ]);
    expect(result.success).toBe(true);
  });
});
