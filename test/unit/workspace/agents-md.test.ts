import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../../../src/workspace/agents-md.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "acme-corp",
    agents: [{ name: "test-agent", role: "inbox-analyst" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    models: { cloud: "anthropic/claude-sonnet-4-5" },
    ...overrides,
  };
}

describe("generateAgentsMd", () => {
  it("should include company name", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).toContain("acme-corp");
  });

  it("should include role display name", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).toContain("Inbox Analyst");
  });

  it("should show Research Agent for research-agent role", () => {
    const md = generateAgentsMd(makeConfig({ agents: [{ name: "test-agent", role: "research-agent" }] }));
    expect(md).toContain("Research Agent");
  });

  it("should show Process Automator for process-automator role", () => {
    const md = generateAgentsMd(makeConfig({ agents: [{ name: "test-agent", role: "process-automator" }] }));
    expect(md).toContain("Process Automator");
  });

  it("should default to autonomous mode", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).toContain("**autonomous** mode");
  });

  it("should show hybrid mode with approval actions", () => {
    const md = generateAgentsMd(
      makeConfig({
        approval: {
          mode: "hybrid",
          require_approval_for: ["browser", "message.send"],
        },
      }),
    );
    expect(md).toContain("**hybrid** mode");
    expect(md).toContain("- browser");
    expect(md).toContain("- message.send");
  });

  it("should include sensitivity keywords when configured", () => {
    const md = generateAgentsMd(
      makeConfig({
        routing: {
          sensitivity: {
            keywords: ["ssn", "credit card"],
          },
        },
      }),
    );
    expect(md).toContain("Data Sensitivity");
    expect(md).toContain("- ssn");
    expect(md).toContain("- credit card");
  });

  it("should not include sensitivity section when no keywords", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).not.toContain("Data Sensitivity");
  });
});

function makeMultiAgentConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-workforce",
    agents: [
      {
        name: "inbox-analyst",
        role: "inbox-analyst",
      },
      {
        name: "research-agent",
        role: "research-agent",
      },
      {
        name: "ultron",
        role: "process-automator",
        supervises: ["inbox-analyst", "research-agent"],
      },
    ],
    models: { cloud: "anthropic/claude-sonnet-4-5" },
    openclaw: { default: { channels: { discord: { enabled: true } } } },
    ...overrides,
  };
}

describe("generateAgentsMd — multi-agent", () => {
  it("should include workforce header", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("Clawforce AI Workforce");
  });

  it("should list all agents with roles", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("inbox-analyst (Inbox Analyst)");
    expect(md).toContain("research-agent (Research Agent)");
    expect(md).toContain("ultron (Process Automator)");
  });

  it("should list supervision relationships", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("**Supervises**: inbox-analyst, research-agent");
  });

  it("should include per-agent SKILL.md paths", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("workspace/inbox-analyst/skills/inbox-analyst/SKILL.md");
    expect(md).toContain("workspace/ultron/skills/process-automator/SKILL.md");
  });
});
