import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupWorkspace } from "../../../src/workspace/setup.js";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClawforceConfig } from "../../../src/config/types.js";

const testDir = join(import.meta.dirname, "../../tmp/workspace-test");

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    role: "inbox-analyst",
    openclaw: {
      channels: {
        discord: { enabled: true },
      },
    },
    models: { primary: "anthropic/claude-sonnet-4-5" },
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
    expect(existsSync(join(testDir, "workspace/skills"))).toBe(true);
    expect(existsSync(join(testDir, "config"))).toBe(true);
    expect(existsSync(join(testDir, "data"))).toBe(true);
    expect(existsSync(join(testDir, "data/cron"))).toBe(true);
  });

  it("should copy role SKILL.md to workspace", () => {
    setupWorkspace(makeConfig(), testDir);
    const skillPath = join(testDir, "workspace/skills/inbox-analyst/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf8");
    expect(content).toContain("Inbox Analyst");
  });

  it("should copy cron jobs for inbox-analyst", () => {
    setupWorkspace(makeConfig(), testDir);
    const cronPath = join(testDir, "data/cron/jobs.json");
    expect(existsSync(cronPath)).toBe(true);
    const jobs = JSON.parse(readFileSync(cronPath, "utf8"));
    expect(jobs[0].name).toBe("daily-briefing");
  });

  it("should not copy cron jobs for research-agent (no cron file)", () => {
    setupWorkspace(makeConfig({ role: "research-agent" }), testDir);
    const cronPath = join(testDir, "data/cron/jobs.json");
    expect(existsSync(cronPath)).toBe(false);
  });

  it("should generate AGENTS.md with company name", () => {
    setupWorkspace(makeConfig(), testDir);
    const agentsMd = readFileSync(
      join(testDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("test-corp");
  });

  it("should generate AGENTS.md with role name", () => {
    setupWorkspace(makeConfig(), testDir);
    const agentsMd = readFileSync(
      join(testDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("Inbox Analyst");
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

  it("should work for research-agent role", () => {
    setupWorkspace(makeConfig({ role: "research-agent" }), testDir);
    const skillPath = join(testDir, "workspace/skills/research-agent/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf8");
    expect(content).toContain("Research Agent");
  });

  it("should work for process-automator role", () => {
    setupWorkspace(makeConfig({ role: "process-automator" }), testDir);
    const skillPath = join(
      testDir,
      "workspace/skills/process-automator/SKILL.md",
    );
    expect(existsSync(skillPath)).toBe(true);
  });

  it("should copy router plugin when router is enabled", () => {
    setupWorkspace(
      makeConfig({ router: { enabled: true } }),
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

  it("should still copy router plugin when explicitly disabled", () => {
    setupWorkspace(
      makeConfig({ router: { enabled: false } }),
      testDir,
    );
    const pluginDir = join(testDir, "config/extensions/clawforce-router");
    expect(existsSync(pluginDir)).toBe(true);
  });

  it("should copy discovered plugins when plugin config is not present", () => {
    setupWorkspace(makeConfig(), testDir);
    const extensionsDir = join(testDir, "config/extensions");
    expect(existsSync(extensionsDir)).toBe(true);
    expect(existsSync(join(extensionsDir, "clawforce-router"))).toBe(true);
    expect(existsSync(join(extensionsDir, "clawforce-compliance"))).toBe(true);
  });

  it("should write auth-profile metadata when credential mode is auth_profile", () => {
    setupWorkspace(
      makeConfig({
        models: {
          primary: "anthropic/claude-sonnet-4-5",
          credential_mode: "auth_profile",
          auth_profile: "corp-prod",
        },
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
