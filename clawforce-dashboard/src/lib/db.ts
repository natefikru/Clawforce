import { DatabaseSync } from "node:sqlite";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const DB_PATH = `${DATA_DIR}/clawforce.db`;

let cachedDb: DatabaseSync | null = null;

export function getReadDb(): DatabaseSync | null {
  if (cachedDb) return cachedDb;
  try {
    cachedDb = new DatabaseSync(DB_PATH, { readOnly: true });
    return cachedDb;
  } catch (err) {
    console.error("[db] Failed to open database:", err);
    return null;
  }
}

/** Reset the cached connection. Call this when a query fails to allow reconnection on next request. */
export function resetReadDb(): void {
  cachedDb = null;
}
