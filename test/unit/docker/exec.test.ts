import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { exec } from "../../../src/docker/exec.js";

class MockProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe("docker exec helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with stdout when command exits 0", async () => {
    const proc = new MockProc();
    spawnMock.mockReturnValue(proc);

    const promise = exec("docker", ["compose", "ps"]);
    proc.stdout.emit("data", Buffer.from("ok\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("ok\n");
  });

  it("rejects with stderr when command exits non-zero", async () => {
    const proc = new MockProc();
    spawnMock.mockReturnValue(proc);

    const promise = exec("docker", ["compose", "ps"]);
    proc.stderr.emit("data", Buffer.from("boom"));
    proc.emit("close", 1);

    await expect(promise).rejects.toThrow(
      'Command "docker compose ps" failed with code 1: boom',
    );
  });

  it("rejects when process fails to start", async () => {
    const proc = new MockProc();
    spawnMock.mockReturnValue(proc);

    const promise = exec("docker", ["compose", "ps"]);
    proc.emit("error", new Error("ENOENT"));

    await expect(promise).rejects.toThrow(
      'Failed to start command "docker": ENOENT',
    );
  });
});
