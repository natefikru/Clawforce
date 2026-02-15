import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const testDeployDir = join(process.cwd(), "clawforce-test-audit");

vi.mock("../../../src/commands/status.js", () => ({
  findDeployDir: vi.fn(() => testDeployDir),
}));

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn().mockRejectedValue(new Error("no container")),
}));

vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import { auditCommand } from "../../../src/commands/audit.js";

describe("auditCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(join(testDeployDir, "data"), { recursive: true });
    writeFileSync(
      join(testDeployDir, "docker-compose.yml"),
      'services:\n  openclaw-gateway:\n    container_name: clawforce-test-gateway',
      "utf8",
    );
  });

  afterEach(() => {
    if (existsSync(testDeployDir)) {
      rmSync(testDeployDir, { recursive: true });
    }
  });

  it("should read and display audit entries", async () => {
    const entries = [
      '{"ts":"2026-02-14T10:00:00Z","agent":"inbox-analyst","action":"slack.read","result":"success"}',
      '{"ts":"2026-02-14T10:01:00Z","agent":"inbox-analyst","action":"slack.send","result":"success"}',
    ];
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      entries.join("\n"),
      "utf8",
    );

    await auditCommand(50);
    expect(console.log).toHaveBeenCalled();
    const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).toContain("slack.read");
    expect(allOutput).toContain("slack.send");
  });

  it("should handle empty audit log", async () => {
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      "",
      "utf8",
    );

    await auditCommand(50);
    const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).toContain("Audit log is empty");
  });

  it("should tail only the last N lines", async () => {
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

    await auditCommand(5);
    const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).toContain("5 of 100");
  });

  it("should handle missing audit file", async () => {
    await auditCommand(50);
    const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).toContain("No audit log found");
  });
});
