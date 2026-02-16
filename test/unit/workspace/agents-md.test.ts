import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../../../src/workspace/agents-md.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "acme-corp",
    role: "inbox-analyst",
    openclaw: {
      channels: {
        discord: { enabled: true },
      },
    },
    models: { primary: "anthropic/claude-sonnet-4-5" },
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
    const md = generateAgentsMd(makeConfig({ role: "research-agent" }));
    expect(md).toContain("Research Agent");
  });

  it("should show Process Automator for process-automator role", () => {
    const md = generateAgentsMd(makeConfig({ role: "process-automator" }));
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

  it("should include sensitivity blocklist when configured", () => {
    const md = generateAgentsMd(
      makeConfig({
        sensitivity: {
          blocklist: ["ssn", "credit card"],
        },
      }),
    );
    expect(md).toContain("Data Sensitivity");
    expect(md).toContain("- ssn");
    expect(md).toContain("- credit card");
  });

  it("should not include sensitivity section when no blocklist", () => {
    const md = generateAgentsMd(makeConfig());
    expect(md).not.toContain("Data Sensitivity");
  });
});
