import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn(),
}));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import { findDeployDir, statusCommand } from "../../../src/commands/status.js";
import { exec } from "../../../src/docker/exec.js";

const testDeployDir = join(process.cwd(), "clawforce-test-status");
const testDataDir = join(process.cwd(), "clawforce-test-status-data");

function setupHealthDb(
  dbPath: string,
  opts: {
    canonical?: Array<{ provider: string; status: string; circuit: string }>;
    alerts?: Array<{ provider: string; status: string; circuit: string }>;
  },
): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_health_state (
      provider TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      circuit TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT
    );
  `);

  for (const row of opts.canonical ?? []) {
    db.prepare(
      `INSERT INTO model_health_state (provider, status, circuit, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(row.provider, row.status, row.circuit);
  }
  for (const row of opts.alerts ?? []) {
    db.prepare(
      `INSERT INTO alerts (ts, type, data) VALUES (?, 'model_health', ?)`,
    ).run(
      new Date().toISOString(),
      JSON.stringify({
        provider: row.provider,
        currentStatus: row.status,
        currentCircuit: row.circuit,
      }),
    );
  }
  db.close();
}

describe("findDeployDir", () => {
  beforeEach(() => {
    mkdirSync(testDeployDir, { recursive: true });
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

  it("should find a deployment directory", () => {
    const dir = findDeployDir();
    expect(dir).toBeTruthy();
    expect(dir!).toContain("clawforce-");
  });
});

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATA_DIR;
    mkdirSync(testDeployDir, { recursive: true });
    writeFileSync(
      join(testDeployDir, "docker-compose.yml"),
      "services: {}",
      "utf8",
    );
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    if (existsSync(testDeployDir)) {
      rmSync(testDeployDir, { recursive: true });
    }
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true });
    }
  });

  it("should call docker compose ps", async () => {
    vi.mocked(exec).mockResolvedValueOnce(
      '{"Name":"clawforce-test-gateway","State":"running","Status":"Up 5m"}\n',
    );
    await statusCommand();
    expect(exec).toHaveBeenCalledWith(
      "docker",
      ["compose", "ps", "--format", "json"],
      expect.objectContaining({
        cwd: expect.stringContaining("clawforce-"),
      }),
    );
  });

  it("should handle no containers", async () => {
    vi.mocked(exec).mockResolvedValueOnce("");
    await statusCommand();
    // Should not throw
  });

  it("should handle docker not running", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("docker not found"));
    await statusCommand();
    // Should not throw
  });

  it("falls back to alerts when canonical health table exists but is empty", async () => {
    vi.mocked(exec).mockResolvedValueOnce(
      '{"Name":"clawforce-test-gateway","State":"running","Status":"Up 5m"}\n',
    );

    process.env.DATA_DIR = testDataDir;
    const dbPath = join(testDataDir, "clawforce.db");
    setupHealthDb(dbPath, {
      canonical: [],
      alerts: [{ provider: "sglang", status: "degraded", circuit: "half_open" }],
    });

    await statusCommand();

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("Model health:");
    expect(logs).toContain("sglang (degraded/half_open)");
  });

  it("uses first candidate path with usable health data", async () => {
    vi.mocked(exec).mockResolvedValueOnce(
      '{"Name":"clawforce-test-gateway","State":"running","Status":"Up 5m"}\n',
    );

    process.env.DATA_DIR = testDataDir;
    setupHealthDb(join(testDataDir, "clawforce.db"), {
      canonical: [],
      alerts: [{ provider: "vllm", status: "down", circuit: "open" }],
    });
    setupHealthDb(join(testDeployDir, "data", "clawforce.db"), {
      canonical: [{ provider: "ollama", status: "healthy", circuit: "closed" }],
    });

    await statusCommand();

    const logs = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logs).toContain("vllm (down/open)");
    expect(logs).not.toContain("ollama (healthy/closed)");
  });
});
