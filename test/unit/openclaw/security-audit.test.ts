import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn(),
}));

import { exec } from "../../../src/docker/exec.js";
import { runSecurityAudit } from "../../../src/openclaw/security-audit.js";

describe("runSecurityAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped result when skip=true", async () => {
    await expect(
      runSecurityAudit({ deployDir: "/tmp/deploy", skip: true }),
    ).resolves.toEqual({
      skipped: true,
      hasCriticalFindings: false,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("marks critical findings when output contains critical", async () => {
    vi.mocked(exec).mockResolvedValue("CRITICAL: insecure binding");
    await expect(
      runSecurityAudit({ deployDir: "/tmp/deploy" }),
    ).resolves.toEqual({
      skipped: false,
      output: "CRITICAL: insecure binding",
      hasCriticalFindings: true,
    });
  });

  it("wraps execution errors with context", async () => {
    vi.mocked(exec).mockRejectedValue(new Error("docker unavailable"));
    await expect(
      runSecurityAudit({ deployDir: "/tmp/deploy" }),
    ).rejects.toThrow(
      "Security audit failed to execute: docker unavailable",
    );
  });
});
