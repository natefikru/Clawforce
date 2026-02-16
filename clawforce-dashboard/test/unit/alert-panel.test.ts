import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panelPath = resolve(
  import.meta.dirname,
  "../../src/components/AlertPanel.tsx",
);

describe("AlertPanel", () => {
  const source = readFileSync(panelPath, "utf8");

  it("fetches unacknowledged alerts from API", () => {
    expect(source).toContain("/api/alerts?unacknowledgedOnly=true");
  });

  it("subscribes to SSE alert events", () => {
    expect(source).toContain('addEventListener("alert"');
    expect(source).toContain("/api/activity/stream");
  });

  it("posts acknowledgement requests", () => {
    expect(source).toContain("/acknowledge");
  });

  it("handles both agent_id and agentId fields", () => {
    expect(source).toContain("agent_id ?? alert.agentId");
  });
});
