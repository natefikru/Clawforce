import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../src/docker/exec.js", () => ({
  exec: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/docker/health.js", () => ({
  waitForHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/openclaw/security-audit.js", () => ({
  runSecurityAudit: vi.fn(),
}));

import { deployCommand } from "../../src/commands/deploy.js";
import { runSecurityAudit } from "../../src/openclaw/security-audit.js";
import { waitForHealthy } from "../../src/docker/health.js";

const fixturesDir = join(import.meta.dirname, "../fixtures");
const deployDir = join(process.cwd(), "clawforce-smoke-no-ollama");

describe("Deploy security audit integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-integration-test";
    delete process.env.CLAWFORCE_SKIP_SECURITY_AUDIT;
    if (existsSync(deployDir)) {
      rmSync(deployDir, { recursive: true });
    }
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAWFORCE_SKIP_SECURITY_AUDIT;
    if (existsSync(deployDir)) {
      rmSync(deployDir, { recursive: true });
    }
  });

  it("blocks deploy completion when security audit reports critical findings", async () => {
    vi.mocked(runSecurityAudit).mockResolvedValue({
      skipped: false,
      output: "CRITICAL: insecure binding detected",
      hasCriticalFindings: true,
    });

    await expect(
      deployCommand(join(fixturesDir, "smoke-config-no-ollama.yaml")),
    ).rejects.toThrow("Security audit failed");

    expect(waitForHealthy).toHaveBeenCalled();
    expect(runSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        deployDir: expect.stringContaining("clawforce-smoke-no-ollama"),
        skip: false,
      }),
    );
  });

  it("passes skip=true to security audit when bypass flag is set", async () => {
    process.env.CLAWFORCE_SKIP_SECURITY_AUDIT = "1";
    vi.mocked(runSecurityAudit).mockResolvedValue({
      skipped: true,
      hasCriticalFindings: false,
    });

    await deployCommand(join(fixturesDir, "smoke-config-no-ollama.yaml"));

    expect(runSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        deployDir: expect.stringContaining("clawforce-smoke-no-ollama"),
        skip: true,
      }),
    );
  });
});
