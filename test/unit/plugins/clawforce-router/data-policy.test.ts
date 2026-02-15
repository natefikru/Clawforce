import { describe, it, expect } from "vitest";
import {
  resolveDataTier,
  tierAllowsCloud,
  tierRequiresLocal,
  type DataPolicy,
} from "../../../../src/plugins/clawforce-router/data-policy.js";

const basePolicy: DataPolicy = {
  defaultTier: "internal",
  channels: [
    { channelId: "C_HR", tier: "restricted", description: "HR channel" },
    { channelId: "C_FINANCE", tier: "confidential" },
    { channelId: "C_PUBLIC", tier: "public" },
    { channelId: "C_GENERAL", tier: "internal" },
  ],
  users: [
    { userId: "U_EXEC", tier: "restricted" },
    { userId: "U_INTERN", tier: "public" },
  ],
};

describe("resolveDataTier", () => {
  it("should resolve channel policy", () => {
    expect(resolveDataTier(basePolicy, "C_HR")).toBe("restricted");
    expect(resolveDataTier(basePolicy, "C_FINANCE")).toBe("confidential");
    expect(resolveDataTier(basePolicy, "C_PUBLIC")).toBe("public");
  });

  it("should resolve user policy when no channel match", () => {
    expect(resolveDataTier(basePolicy, undefined, "U_EXEC")).toBe("restricted");
    expect(resolveDataTier(basePolicy, undefined, "U_INTERN")).toBe("public");
  });

  it("should prefer channel over user policy", () => {
    // Channel is public, user is restricted — channel wins
    expect(resolveDataTier(basePolicy, "C_PUBLIC", "U_EXEC")).toBe("public");
  });

  it("should return default tier when no match", () => {
    expect(resolveDataTier(basePolicy, "C_UNKNOWN", "U_UNKNOWN")).toBe("internal");
  });

  it("should return default tier with no channel or user", () => {
    expect(resolveDataTier(basePolicy)).toBe("internal");
  });

  it("should return default tier when channels/users arrays are empty", () => {
    const emptyPolicy: DataPolicy = { defaultTier: "restricted" };
    expect(resolveDataTier(emptyPolicy, "C_ANY", "U_ANY")).toBe("restricted");
  });

  it("should handle policy with only channels", () => {
    const channelOnly: DataPolicy = {
      defaultTier: "public",
      channels: [{ channelId: "C1", tier: "confidential" }],
    };
    expect(resolveDataTier(channelOnly, "C1")).toBe("confidential");
    expect(resolveDataTier(channelOnly, undefined, "U1")).toBe("public");
  });

  it("should handle policy with only users", () => {
    const userOnly: DataPolicy = {
      defaultTier: "public",
      users: [{ userId: "U1", tier: "restricted" }],
    };
    expect(resolveDataTier(userOnly, "C1")).toBe("public");
    expect(resolveDataTier(userOnly, undefined, "U1")).toBe("restricted");
  });
});

describe("tierAllowsCloud", () => {
  it("should allow cloud for public tier only", () => {
    expect(tierAllowsCloud("public")).toBe(true);
  });

  it("should not allow cloud for restricted", () => {
    expect(tierAllowsCloud("restricted")).toBe(false);
  });

  it("should not allow cloud for confidential", () => {
    expect(tierAllowsCloud("confidential")).toBe(false);
  });

  it("should not allow cloud for internal", () => {
    expect(tierAllowsCloud("internal")).toBe(false);
  });
});

describe("tierRequiresLocal", () => {
  it("should require local for restricted", () => {
    expect(tierRequiresLocal("restricted")).toBe(true);
  });

  it("should require local for confidential", () => {
    expect(tierRequiresLocal("confidential")).toBe(true);
  });

  it("should not require local for internal", () => {
    expect(tierRequiresLocal("internal")).toBe(false);
  });

  it("should not require local for public", () => {
    expect(tierRequiresLocal("public")).toBe(false);
  });
});
