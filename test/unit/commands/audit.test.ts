import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn().mockResolvedValue(""),
}));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import { auditCommand } from "../../../src/commands/audit.js";

const testDeployDir = join(process.cwd(), "clawforce-test-audit");

describe("auditCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(join(testDeployDir, "data"), { recursive: true });
    writeFileSync(
      join(testDeployDir, "docker-compose.yml"),
      "services: {}",
      "utf8",
    );
  });

  afterEach(() => {
    if (existsSync(testDeployDir)) {
      rmSync(testDeployDir, { recursive: true });
    }
  });

  it("should read and display audit entries", () => {
    const entries = [
      '{"ts":"2026-02-14T10:00:00Z","agent":"inbox-analyst","action":"slack.read","result":"success"}',
      '{"ts":"2026-02-14T10:01:00Z","agent":"inbox-analyst","action":"slack.send","result":"success"}',
    ];
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      entries.join("\n"),
      "utf8",
    );

    auditCommand(50);
    // Should not throw, should log entries
    expect(console.log).toHaveBeenCalled();
  });

  it("should handle empty audit log", () => {
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      "",
      "utf8",
    );

    auditCommand(50);
    // Should not throw
  });

  it("should tail only the last N lines", () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({
        ts: `2026-02-14T${String(i).padStart(2, "0")}:00:00Z`,
        agent: "test",
        action: `action-${i}`,
        result: "success",
      }),
    );
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      entries.join("\n"),
      "utf8",
    );

    auditCommand(5);
    // The last log line should mention "last 5 of 100"
    const calls = vi.mocked(console.log).mock.calls;
    const lastCallArgs = calls[calls.length - 1];
    expect(lastCallArgs.join(" ")).toContain("5 of 100");
  });

  it("should handle missing audit file", () => {
    // No audit.jsonl created
    auditCommand(50);
    // Should not throw
  });
});
