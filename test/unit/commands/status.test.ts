import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn(),
}));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import { findDeployDir, statusCommand } from "../../../src/commands/status.js";
import { exec } from "../../../src/docker/exec.js";

const testDeployDir = join(process.cwd(), "clawforce-test-status");

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
});
