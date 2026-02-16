import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/docker/exec.js", () => ({
  exec: vi.fn(),
}));

import { exec } from "../../../src/docker/exec.js";
import { waitForHealthy } from "../../../src/docker/health.js";

describe("waitForHealthy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when container reports running", async () => {
    vi.mocked(exec).mockResolvedValue("true\n");
    await expect(waitForHealthy("container", "/tmp", 10, 1)).resolves.toBe(true);
  });

  it("returns false when timeout is reached", async () => {
    vi.mocked(exec).mockResolvedValue("false\n");
    await expect(waitForHealthy("container", "/tmp", 5, 2)).resolves.toBe(false);
  });

  it("keeps polling when inspect errors transiently", async () => {
    vi.mocked(exec)
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce("true\n");

    await expect(waitForHealthy("container", "/tmp", 50, 1)).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
