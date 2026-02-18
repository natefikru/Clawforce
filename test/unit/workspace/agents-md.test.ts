import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../../../src/workspace/agents-md.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "acme-corp",
    agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
    },
    ...overrides,
  };
}

describe("generateAgentsMd", () => {
  it("should include company name", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).toContain("acme-corp");
  });

  it("should include agent name", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).toContain("test-agent");
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
        workspace: "./workspaces/inbox-analyst",
        runtime: "openclaw",
      },
      {
        name: "research-agent",
        workspace: "./workspaces/research-agent",
        runtime: "openclaw",
      },
      {
        name: "ultron",
        workspace: "./workspaces/ultron",
        runtime: "openclaw",
        supervises: ["inbox-analyst", "research-agent"],
      },
    ],
    openclaw: { default: { channels: { discord: { enabled: true } } } },
    ...overrides,
  };
}

describe("generateAgentsMd — multi-agent", () => {
  it("should include workforce header", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("Clawforce AI Workforce");
  });

  it("should list all agents by name", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("inbox-analyst");
    expect(md).toContain("research-agent");
    expect(md).toContain("ultron");
  });

  it("should list supervision relationships", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("**Supervises**: inbox-analyst, research-agent");
  });

  it("should include per-agent workspace paths", () => {
    const md = generateAgentsMd(makeMultiAgentConfig());
    expect(md).toContain("inbox-analyst");
    expect(md).toContain("ultron");
  });
});
