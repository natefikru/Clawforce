import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// Mock docker exec and health check before importing deploy
vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../../src/docker/health.js", () => ({
  waitForHealthy: vi.fn().mockResolvedValue(true),
}));

// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import { deployCommand } from "../../../src/commands/deploy.js";
import { exec } from "../../../src/docker/exec.js";
import { waitForHealthy } from "../../../src/docker/health.js";

const fixturesDir = join(import.meta.dirname, "../../fixtures");
const deployDir = join(process.cwd(), "clawforce-test-corp");

describe("deployCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
    if (existsSync(deployDir)) {
      rmSync(deployDir, { recursive: true });
    }
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAWFORCE_SKIP_SECURITY_AUDIT;
    delete process.env.CI;
    delete process.env.NODE_ENV;
    if (existsSync(deployDir)) {
      rmSync(deployDir, { recursive: true });
    }
  });

  it("should create deployment directory", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(existsSync(deployDir)).toBe(true);
  });

  it("should generate openclaw.json", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    const configPath = join(deployDir, "config", "openclaw.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.agents.defaults.model.primary).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect(config.channels.slack.enabled).toBe(true);
  });

  it("should generate docker-compose.yml", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    const composePath = join(deployDir, "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);

    const compose = parseYaml(readFileSync(composePath, "utf8"));
    expect(compose.services["openclaw-gateway"]).toBeDefined();
  });

  it("should generate .env", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    const envPath = join(deployDir, ".env");
    expect(existsSync(envPath)).toBe(true);

    const env = readFileSync(envPath, "utf8");
    expect(env).toContain("GATEWAY_TOKEN=");
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("should setup workspace with SKILL.md and AGENTS.md", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(
      existsSync(join(deployDir, "workspace/skills/inbox-analyst/SKILL.md")),
    ).toBe(true);
    expect(existsSync(join(deployDir, "workspace/AGENTS.md"))).toBe(true);
  });

  it("should call docker compose up", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(exec).toHaveBeenCalledWith(
      "docker",
      ["compose", "up", "-d"],
      expect.objectContaining({ cwd: deployDir }),
    );
  });

  it("should check container health", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(waitForHealthy).toHaveBeenCalledWith(
      "clawforce-test-corp-gateway",
      expect.stringContaining("clawforce-test-corp"),
      30000,
    );
  });

  it("should throw if container fails to start", async () => {
    vi.mocked(waitForHealthy).mockResolvedValueOnce(false);
    await expect(
      deployCommand(join(fixturesDir, "valid-config.yaml")),
    ).rejects.toThrow("Container failed to start");
  });

  it("should pull ollama model when enabled", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    // valid-config.yaml has ollama enabled with llama3.3:8b
    expect(exec).toHaveBeenCalledWith(
      "docker",
      ["compose", "up", "-d", "ollama"],
      expect.objectContaining({ cwd: deployDir }),
    );
    expect(exec).toHaveBeenCalledWith(
      "docker",
      [
        "exec",
        "clawforce-test-corp-ollama",
        "ollama",
        "pull",
        "llama3.3:8b",
      ],
      expect.objectContaining({ cwd: deployDir }),
    );
  });

  it("should not pull ollama when disabled", async () => {
    const minimalDeployDir = join(process.cwd(), "clawforce-minimal");
    await deployCommand(join(fixturesDir, "minimal-config.yaml"));
    // minimal config doesn't have ollama
    expect(exec).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["ollama", "pull"]),
      expect.anything(),
    );
    if (existsSync(minimalDeployDir)) {
      rmSync(minimalDeployDir, { recursive: true });
    }
  });

  it("should run openclaw security audit inside gateway container", async () => {
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(exec).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "openclaw-gateway",
        "node",
        "dist/index.js",
        "security",
        "audit",
        "--deep",
      ],
      expect.objectContaining({ cwd: deployDir }),
    );
  });

  it("should fail deploy when audit output contains critical findings", async () => {
    vi.mocked(exec).mockImplementation(async (_command, args) => {
      if (
        args[0] === "compose" &&
        args[1] === "exec" &&
        args.includes("security") &&
        args.includes("audit")
      ) {
        return "CRITICAL: gateway.bind is not secure";
      }
      return "";
    });

    await expect(
      deployCommand(join(fixturesDir, "valid-config.yaml")),
    ).rejects.toThrow("Security audit failed");
  });

  it("should skip security audit when bypass flag is set", async () => {
    process.env.CLAWFORCE_SKIP_SECURITY_AUDIT = "1";
    await deployCommand(join(fixturesDir, "valid-config.yaml"));
    expect(exec).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["security", "audit", "--deep"]),
      expect.anything(),
    );
  });

  it("should reject security audit bypass in CI contexts", async () => {
    process.env.CLAWFORCE_SKIP_SECURITY_AUDIT = "1";
    process.env.CI = "true";

    await expect(
      deployCommand(join(fixturesDir, "valid-config.yaml")),
    ).rejects.toThrow("Security audit bypass is not allowed in CI or production");
  });
});
