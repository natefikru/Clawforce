import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:sqlite", () => ({
  __esModule: true,
  allMock: vi.fn(),
  closeMock: vi.fn(),
  DatabaseSync: class {
    prepare() {
      return { all: (globalThis as { __allMock?: () => unknown[] }).__allMock };
    }
    close() {
      (globalThis as { __closeMock?: () => void }).__closeMock?.();
    }
  },
}));

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { getContainerStatus } from "../container-status";

const execFileMock = vi.mocked(execFile);
const existsSyncMock = vi.mocked(existsSync);
const allMock = vi.fn();
const closeMock = vi.fn();

describe("getContainerStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_DIR = "/tmp/data";
    (globalThis as { __allMock?: typeof allMock }).__allMock = allMock;
    (globalThis as { __closeMock?: typeof closeMock }).__closeMock = closeMock;
  });

  it("returns container status with model health summary", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(
        null,
        {
          stdout:
            "clawforce-test-gateway|Up 2 minutes\nclawforce-test-sglang|Up 2 minutes\n",
          stderr: "",
        } as never,
      );
    });
    existsSyncMock.mockReturnValue(true);
    allMock.mockReturnValue([
      {
        provider: "sglang",
        status: "healthy",
        circuit: "closed",
      },
    ]);

    const result = await getContainerStatus();
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("running");
    expect(result[0].modelHealth).toEqual({
      sglang: { status: "healthy", circuit: "closed" },
    });
    expect(closeMock).toHaveBeenCalled();
  });

  it("returns empty list when docker output is empty", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: "", stderr: "" } as never);
    });

    const result = await getContainerStatus();
    expect(result).toEqual([]);
  });
});
