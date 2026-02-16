import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { hash, compare } from "bcryptjs";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dashboard-auth-test-"));
  vi.stubEnv("DATA_DIR", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function seedUser(
  username: string,
  password: string,
  role: string,
): Promise<void> {
  const db = new DatabaseSync(join(tmpDir, "clawforce.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const passwordHash = await hash(password, 10);
  db.prepare(
    "INSERT INTO dashboard_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
  ).run(`test-${username}`, username, passwordHash, role);
  db.close();
}

describe("Auth authorize flow (DB + bcrypt)", () => {
  it("getReadDb returns working connection after seeding", async () => {
    await seedUser("admin", "test12345", "admin");

    const { getReadDb } = await import("@/lib/db");
    const db = getReadDb();
    expect(db).not.toBeNull();

    const user = db!
      .prepare("SELECT username, role FROM dashboard_users WHERE username = ?")
      .get("admin") as { username: string; role: string } | undefined;

    expect(user).toBeDefined();
    expect(user!.username).toBe("admin");
    expect(user!.role).toBe("admin");

    db!.close();
  });

  it("getReadDb query returns undefined for non-existent user", async () => {
    await seedUser("admin", "test12345", "admin");

    const { getReadDb } = await import("@/lib/db");
    const db = getReadDb();
    expect(db).not.toBeNull();

    const user = db!
      .prepare("SELECT username FROM dashboard_users WHERE username = ?")
      .get("nonexistent");

    expect(user).toBeUndefined();
    db!.close();
  });

  it("password verification works with bcryptjs", async () => {
    await seedUser("admin", "test12345", "admin");

    const { getReadDb } = await import("@/lib/db");
    const db = getReadDb();
    const user = db!
      .prepare("SELECT password_hash FROM dashboard_users WHERE username = ?")
      .get("admin") as { password_hash: string };

    expect(await compare("test12345", user.password_hash)).toBe(true);
    expect(await compare("wrongpassword", user.password_hash)).toBe(false);

    db!.close();
  });

  it("full authorize simulation: lookup user + verify password", async () => {
    await seedUser("admin", "test12345", "admin");
    await seedUser("viewer1", "viewerpass", "viewer");

    const { getReadDb } = await import("@/lib/db");

    // Simulate what authorize() does
    function authorize(
      username: string,
      password: string,
    ): Promise<{ id: string; name: string; role: string } | null> {
      const db = getReadDb();
      if (!db) return Promise.resolve(null);

      const user = db
        .prepare(
          "SELECT id, username, password_hash, role FROM dashboard_users WHERE username = ?",
        )
        .get(username) as
        | {
            id: string;
            username: string;
            password_hash: string;
            role: string;
          }
        | undefined;

      if (!user) return Promise.resolve(null);
      return compare(password, user.password_hash).then((valid) =>
        valid
          ? { id: user.id, name: user.username, role: user.role }
          : null,
      );
    }

    // Valid admin login
    const admin = await authorize("admin", "test12345");
    expect(admin).not.toBeNull();
    expect(admin!.name).toBe("admin");
    expect(admin!.role).toBe("admin");

    // Valid viewer login
    const viewer = await authorize("viewer1", "viewerpass");
    expect(viewer).not.toBeNull();
    expect(viewer!.role).toBe("viewer");

    // Wrong password
    const wrongPass = await authorize("admin", "wrongpass");
    expect(wrongPass).toBeNull();

    // Non-existent user
    const noUser = await authorize("nobody", "test12345");
    expect(noUser).toBeNull();

    getReadDb()?.close();
  });
});
