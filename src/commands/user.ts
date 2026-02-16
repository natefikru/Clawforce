import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getDatabase, closeDatabase } from "../storage/database.js";
import { logger } from "../utils/logger.js";

async function loadBcrypt(): Promise<typeof import("bcryptjs")> {
  return import("bcryptjs");
}

export async function userAddCommand(
  username: string,
  options: { role: string; password: string; dataDir: string },
): Promise<void> {
  const { hash } = await loadBcrypt();
  const dbPath = resolve(options.dataDir, "clawforce.db");
  const db = getDatabase(dbPath);

  try {
    const existing = db
      .prepare("SELECT id FROM dashboard_users WHERE username = ?")
      .get(username) as { id: string } | undefined;

    if (existing) {
      logger.error(`User "${username}" already exists.`);
      return;
    }

    const passwordHash = await hash(options.password, 10);
    const id = randomUUID();

    db.prepare(
      "INSERT INTO dashboard_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
    ).run(id, username, passwordHash, options.role);

    logger.success(`User "${username}" created with role "${options.role}".`);
  } finally {
    closeDatabase();
  }
}

export async function userListCommand(options: {
  dataDir: string;
}): Promise<void> {
  const dbPath = resolve(options.dataDir, "clawforce.db");
  const db = getDatabase(dbPath);

  try {
    const users = db
      .prepare(
        "SELECT username, role, created_at FROM dashboard_users ORDER BY created_at",
      )
      .all() as { username: string; role: string; created_at: string }[];

    if (users.length === 0) {
      logger.info("No dashboard users found.");
      return;
    }

    logger.header("Dashboard Users");
    for (const user of users) {
      logger.info(`${user.username} (${user.role}) — created ${user.created_at}`);
    }
  } finally {
    closeDatabase();
  }
}

export async function userRemoveCommand(
  username: string,
  options: { dataDir: string },
): Promise<void> {
  const dbPath = resolve(options.dataDir, "clawforce.db");
  const db = getDatabase(dbPath);

  try {
    const result = db
      .prepare("DELETE FROM dashboard_users WHERE username = ?")
      .run(username);

    if (result.changes === 0) {
      logger.error(`User "${username}" not found.`);
      return;
    }

    logger.success(`User "${username}" removed.`);
  } finally {
    closeDatabase();
  }
}
