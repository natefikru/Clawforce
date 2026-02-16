import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/commands/status.js", () => ({
  findDeployDir: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    header: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { exec } from "../../../src/docker/exec.js";
import { findDeployDir } from "../../../src/commands/status.js";
import { logger } from "../../../src/utils/logger.js";
import { stopCommand } from "../../../src/commands/stop.js";

describe("stopCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs error and returns when deploy dir is missing", async () => {
    vi.mocked(findDeployDir).mockReturnValue(null);
    await stopCommand();
    expect(logger.error).toHaveBeenCalledWith("No deployment found in current directory.");
    expect(exec).not.toHaveBeenCalled();
  });

  it("stops deployment when deploy dir exists", async () => {
    vi.mocked(findDeployDir).mockReturnValue("/tmp/clawforce-test");
    vi.mocked(exec).mockResolvedValue("");

    await stopCommand();
    expect(exec).toHaveBeenCalledWith(
      "docker",
      ["compose", "down"],
      { cwd: "/tmp/clawforce-test" },
    );
    expect(logger.success).toHaveBeenCalledWith("Deployment stopped.");
  });

  it("logs error when docker compose down fails", async () => {
    vi.mocked(findDeployDir).mockReturnValue("/tmp/clawforce-test");
    vi.mocked(exec).mockRejectedValue(new Error("down failed"));

    await stopCommand();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to stop"));
  });
});
