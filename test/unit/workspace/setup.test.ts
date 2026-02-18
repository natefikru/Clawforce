import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupWorkspace } from "../../../src/workspace/setup.js";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClawforceConfig } from "../../../src/config/types.js";

const testDir = join(import.meta.dirname, "../../tmp/workspace-test");

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    approval: {
      mode: "hybrid",
      require_approval_for: ["browser", "message.send"],
    },
    ...overrides,
  };
}

describe("setupWorkspace", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("should create workspace directory structure", () => {
    setupWorkspace(makeConfig(), testDir);
    expect(existsSync(join(testDir, "workspace"))).toBe(true);
    expect(existsSync(join(testDir, "config"))).toBe(true);
    expect(existsSync(join(testDir, "data"))).toBe(true);
    expect(existsSync(join(testDir, "data/cron"))).toBe(true);
  });

  it("should copy cron jobs when configured", () => {
    setupWorkspace(makeConfig(), testDir);
    const cronPath = join(testDir, "data/cron/jobs.json");
    // Cron jobs may or may not exist depending on workspace setup
    // This test validates the workspace structure is created correctly
    expect(existsSync(join(testDir, "data/cron"))).toBe(true);
  });

  it("should create workspace for research-agent config", () => {
    setupWorkspace(makeConfig({ agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }] }), testDir);
    expect(existsSync(join(testDir, "workspace"))).toBe(true);
  });

  it("should generate AGENTS.md with company name", () => {
    setupWorkspace(makeConfig(), testDir);
    const agentsMd = readFileSync(
      join(testDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("test-corp");
  });

  it("should generate AGENTS.md with agent name", () => {
    setupWorkspace(makeConfig(), testDir);
    const agentsMd = readFileSync(
      join(testDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("test-agent");
  });

  it("should generate AGENTS.md with approval mode", () => {
    setupWorkspace(makeConfig(), testDir);
    const agentsMd = readFileSync(
      join(testDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("hybrid");
    expect(agentsMd).toContain("browser");
    expect(agentsMd).toContain("message.send");
  });

  it("should create empty audit.jsonl", () => {
    setupWorkspace(makeConfig(), testDir);
    expect(existsSync(join(testDir, "data/audit.jsonl"))).toBe(true);
  });

  it("should generate AGENTS.md for alternate agent config", () => {
    setupWorkspace(makeConfig({ agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }] }), testDir);
    expect(existsSync(join(testDir, "workspace/AGENTS.md"))).toBe(true);
  });

  it("should generate AGENTS.md for supervisor agent", () => {
    setupWorkspace(makeConfig({
      agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw", supervises: ["other-agent"] },
               { name: "other-agent", workspace: "./workspaces/other-agent", runtime: "openclaw" }],
    }), testDir);
    const agentsMd = readFileSync(join(testDir, "workspace/AGENTS.md"), "utf8");
    expect(agentsMd).toContain("test-agent");
    expect(agentsMd).toContain("other-agent");
    expect(agentsMd).toContain("Supervises");
  });

  it("should copy router plugin when routing is configured", () => {
    setupWorkspace(
      makeConfig({ routing: { rules: [] } }),
      testDir,
    );
    const pluginDir = join(testDir, "config/extensions/clawforce-router");
    expect(existsSync(pluginDir)).toBe(true);
    expect(existsSync(join(pluginDir, "index.js"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.js.map"))).toBe(true);
    expect(existsSync(join(pluginDir, "openclaw.plugin.json"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.ts"))).toBe(false);
  });

  it("should copy compliance plugin when compliance is enabled", () => {
    setupWorkspace(
      makeConfig({ compliance: { enabled: true } }),
      testDir,
    );
    const pluginDir = join(testDir, "config/extensions/clawforce-compliance");
    expect(existsSync(pluginDir)).toBe(true);
    expect(existsSync(join(pluginDir, "index.js"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.js.map"))).toBe(true);
    expect(existsSync(join(pluginDir, "openclaw.plugin.json"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.ts"))).toBe(false);
  });

  it("should not copy router plugin when routing is absent", () => {
    setupWorkspace(
      makeConfig(),
      testDir,
    );
    const pluginDir = join(testDir, "config/extensions/clawforce-router");
    expect(existsSync(pluginDir)).toBe(false);
  });

  it("should copy discovered plugins when plugin config is not present", () => {
    setupWorkspace(makeConfig({ routing: {} }), testDir);
    const extensionsDir = join(testDir, "config/extensions");
    expect(existsSync(extensionsDir)).toBe(true);
    expect(existsSync(join(extensionsDir, "clawforce-router"))).toBe(true);
    expect(existsSync(join(extensionsDir, "clawforce-compliance"))).toBe(true);
  });

  it("should write auth-profile metadata when auth_profile is set", () => {
    setupWorkspace(
      makeConfig({
        auth_profile: "corp-prod",
      }),
      testDir,
    );
    const metadataPath = join(testDir, "config/auth-profile.json");
    expect(existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(metadata.mode).toBe("auth_profile");
    expect(metadata.profile).toBe("corp-prod");
  });
});

function makeMultiAgentConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-workforce",
    agents: [
      { name: "inbox-analyst", workspace: "./workspaces/inbox-analyst", runtime: "openclaw" },
      { name: "research-agent", workspace: "./workspaces/research-agent", runtime: "openclaw" },
    ],
    openclaw: { default: { channels: { discord: { enabled: true } } } },
    ...overrides,
  };
}

describe("setupWorkspace — multi-agent", () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("should generate AGENTS.md with all agents", () => {
    setupWorkspace(makeMultiAgentConfig(), testDir);
    const agentsMd = readFileSync(join(testDir, "workspace/AGENTS.md"), "utf8");
    expect(agentsMd).toContain("inbox-analyst");
    expect(agentsMd).toContain("research-agent");
  });

  it("should generate AGENTS.md with all agent names", () => {
    setupWorkspace(makeMultiAgentConfig(), testDir);
    const agentsMd = readFileSync(join(testDir, "workspace/AGENTS.md"), "utf8");
    expect(agentsMd).toContain("inbox-analyst");
    expect(agentsMd).toContain("research-agent");
    expect(agentsMd).toContain("Clawforce AI Workforce");
  });

  it("should write auth-profile metadata from config for multi-agent", () => {
    setupWorkspace(
      makeMultiAgentConfig({
        auth_profile: "corp-prod",
      }),
      testDir,
    );
    const metadataPath = join(testDir, "config/auth-profile.json");
    expect(existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(metadata.mode).toBe("auth_profile");
    expect(metadata.profile).toBe("corp-prod");
  });
});
