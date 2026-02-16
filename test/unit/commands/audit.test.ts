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
      '{"ts":"2026-02-14T10:00:00Z","agent":"inbox-analyst","action":"message.read","result":"success"}',
      '{"ts":"2026-02-14T10:01:00Z","agent":"inbox-analyst","action":"message.send","result":"success"}',
    ];
    writeFileSync(
      join(testDeployDir, "data", "audit.jsonl"),
      entries.join("\n"),
      "utf8",
    );

    await auditCommand(50);
    expect(console.log).toHaveBeenCalled();
    const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).toContain("message.read");
    expect(allOutput).toContain("message.send");
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

  describe("compliance source", () => {
    it("should read compliance.jsonl when source is compliance", async () => {
      const entries = [
        '{"ts":"2026-02-15T00:00:00Z","event":"tool_call","tool":"exec","success":true,"durationMs":150}',
        '{"ts":"2026-02-15T00:01:00Z","event":"message_sent","to":"user","channel":"generic","contentLength":42,"model":"claude-sonnet-4-5"}',
      ];
      writeFileSync(
        join(testDeployDir, "data", "compliance.jsonl"),
        entries.join("\n"),
        "utf8",
      );

      await auditCommand(50, "compliance");
      const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("tool_call");
      expect(allOutput).toContain("exec");
      expect(allOutput).toContain("message_sent");
      expect(allOutput).toContain("compliance entries");
    });

    it("should handle missing compliance log", async () => {
      await auditCommand(50, "compliance");
      const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("No compliance log found");
    });

    it("should handle empty compliance log", async () => {
      writeFileSync(
        join(testDeployDir, "data", "compliance.jsonl"),
        "",
        "utf8",
      );

      await auditCommand(50, "compliance");
      const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Compliance log is empty");
    });

    it("should format routing_decision events", async () => {
      const entry = '{"ts":"2026-02-15T00:00:00Z","event":"routing_decision","model":"ollama/llama3.3:8b","reason":"PII detected"}';
      writeFileSync(
        join(testDeployDir, "data", "compliance.jsonl"),
        entry,
        "utf8",
      );

      await auditCommand(50, "compliance");
      const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("routing_decision");
      expect(allOutput).toContain("ollama/llama3.3:8b");
    });

    it("should tail compliance entries", async () => {
      const entries = Array.from({ length: 50 }, (_, i) =>
        JSON.stringify({
          ts: `2026-02-15T${String(i).padStart(2, "0")}:00:00Z`,
          event: "tool_call",
          tool: `tool-${i}`,
          success: true,
        }),
      );
      writeFileSync(
        join(testDeployDir, "data", "compliance.jsonl"),
        entries.join("\n"),
        "utf8",
      );

      await auditCommand(5, "compliance");
      const allOutput = vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("5 of 50");
    });
  });
});
