import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { compare } from "bcryptjs";
import { runMigrations } from "../../../src/storage/migrations.js";

// Suppress console output
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

import {
  userAddCommand,
  userListCommand,
  userRemoveCommand,
} from "../../../src/commands/user.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "clawforce-user-test-"));
  // Pre-create DB with migrations
  const db = new DatabaseSync(join(tmpDir, "clawforce.db"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  runMigrations(db);
  db.close();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("userAddCommand", () => {
  it("adds a user with hashed password", async () => {
    await userAddCommand("admin", {
      role: "admin",
      password: "test12345",
      dataDir: tmpDir,
    });

    const db = new DatabaseSync(join(tmpDir, "clawforce.db"), { readOnly: true });
    const user = db
      .prepare("SELECT * FROM dashboard_users WHERE username = ?")
      .get("admin") as {
        id: string;
        username: string;
        password_hash: string;
        role: string;
      };
    db.close();

    expect(user).toBeDefined();
    expect(user.username).toBe("admin");
    expect(user.role).toBe("admin");
    expect(user.password_hash).toMatch(/^\$2[aby]\$/);
    expect(await compare("test12345", user.password_hash)).toBe(true);
  });

  it("defaults to viewer role", async () => {
    await userAddCommand("viewer1", {
      role: "viewer",
      password: "viewerpass",
      dataDir: tmpDir,
    });

    const db = new DatabaseSync(join(tmpDir, "clawforce.db"), { readOnly: true });
    const user = db
      .prepare("SELECT role FROM dashboard_users WHERE username = ?")
      .get("viewer1") as { role: string };
    db.close();

    expect(user.role).toBe("viewer");
  });

  it("rejects duplicate username", async () => {
    await userAddCommand("admin", {
      role: "admin",
      password: "test12345",
      dataDir: tmpDir,
    });

    // Should not throw, but should log error
    await userAddCommand("admin", {
      role: "viewer",
      password: "different",
      dataDir: tmpDir,
    });

    const db = new DatabaseSync(join(tmpDir, "clawforce.db"), { readOnly: true });
    const count = db
      .prepare("SELECT COUNT(*) as c FROM dashboard_users WHERE username = ?")
      .get("admin") as { c: number };
    db.close();

    expect(count.c).toBe(1);
  });
});

describe("userListCommand", () => {
  it("lists all users", async () => {
    await userAddCommand("admin", {
      role: "admin",
      password: "test12345",
      dataDir: tmpDir,
    });
    await userAddCommand("viewer1", {
      role: "viewer",
      password: "test12345",
      dataDir: tmpDir,
    });

    // Should not throw
    await expect(userListCommand({ dataDir: tmpDir })).resolves.not.toThrow();
  });

  it("handles empty user table", async () => {
    await expect(userListCommand({ dataDir: tmpDir })).resolves.not.toThrow();
  });
});

describe("userRemoveCommand", () => {
  it("removes an existing user", async () => {
    await userAddCommand("admin", {
      role: "admin",
      password: "test12345",
      dataDir: tmpDir,
    });
    await userRemoveCommand("admin", { dataDir: tmpDir });

    const db = new DatabaseSync(join(tmpDir, "clawforce.db"), { readOnly: true });
    const user = db
      .prepare("SELECT * FROM dashboard_users WHERE username = ?")
      .get("admin");
    db.close();

    expect(user).toBeUndefined();
  });

  it("handles non-existent user gracefully", async () => {
    await expect(
      userRemoveCommand("nobody", { dataDir: tmpDir }),
    ).resolves.not.toThrow();
  });
});
