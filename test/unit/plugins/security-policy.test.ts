import { describe, expect, it } from "vitest";
import { enforcePluginSecurityPolicy } from "../../../src/plugins/security-policy.js";
import type { OpenClawPluginManifest } from "../../../src/plugins/manifest-schema.js";

function makeManifest(
  overrides: Partial<OpenClawPluginManifest> = {},
): OpenClawPluginManifest {
  return {
    id: "test-plugin",
    version: "1.0.0",
    engines: {
      clawforce: ">=0.1.0",
      openclaw: ">=0.1.0",
    },
    capabilities: ["routing"],
    permissions: ["hooks:before_agent_start"],
    configSchema: { type: "object" },
    ...overrides,
  };
}

describe("enforcePluginSecurityPolicy", () => {
  it("accepts manifests with allowlisted permissions", () => {
    const manifest = makeManifest();
    expect(() => enforcePluginSecurityPolicy(manifest)).not.toThrow();
  });

  it("rejects unsupported permissions", () => {
    const manifest = makeManifest({
      permissions: ["hooks:before_agent_start", "hooks:internal_private_hook"],
    });
    expect(() => enforcePluginSecurityPolicy(manifest)).toThrow(
      'declares unsupported permission "hooks:internal_private_hook"',
    );
  });

  it("rejects missing routing permission coverage", () => {
    const manifest = makeManifest({
      capabilities: ["routing"],
      permissions: ["storage:write"],
    });
    expect(() => enforcePluginSecurityPolicy(manifest)).toThrow(
      'capability "routing" requires permission "hooks:before_agent_start"',
    );
  });

  it("rejects missing compliance logging hook coverage", () => {
    const manifest = makeManifest({
      capabilities: ["compliance-logging"],
      permissions: ["hooks:after_tool_call", "hooks:message_received"],
    });
    expect(() => enforcePluginSecurityPolicy(manifest)).toThrow(
      'capability "compliance-logging" requires permission "hooks:message_sent"',
    );
  });
});

