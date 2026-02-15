import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseJsonl, getLatestEntries } from "@/lib/log-parser";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;
const DB_PATH = `${DATA_DIR}/clawforce.db`;

// Cached singleton — opened once, reused across requests
let cachedDb: DatabaseSync | null = null;

function getReadDb(): DatabaseSync | null {
  if (cachedDb) return cachedDb;
  try {
    cachedDb = new DatabaseSync(DB_PATH, { readOnly: true });
    return cachedDb;
  } catch {
    return null; // DB doesn't exist or can't be opened
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 1000);
  const eventFilter = searchParams.get("event");

  // Try SQLite first
  const db = getReadDb();
  if (db) {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (eventFilter) {
        conditions.push("event = ?");
        params.push(eventFilter);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = db.prepare(
        `SELECT data FROM compliance_events ${where} ORDER BY ts DESC LIMIT ?`,
      ).all(...params, limit) as { data: string }[];

      const entries = rows.map((r) => JSON.parse(r.data));

      const countRow = db.prepare(
        `SELECT COUNT(*) as total FROM compliance_events ${where}`,
      ).get(...params) as { total: number };

      return NextResponse.json({ entries, total: countRow.total });
    } catch {
      // Fall through to JSONL
    }
  }

  // JSONL fallback
  try {
    if (!existsSync(COMPLIANCE_LOG)) {
      return NextResponse.json({ entries: [], total: 0 });
    }

    const content = await readFile(COMPLIANCE_LOG, "utf8");
    let entries = parseJsonl(content);

    if (eventFilter) {
      entries = entries.filter((e) => e.event === eventFilter);
    }

    const total = entries.length;
    const latest = getLatestEntries(entries, limit);

    return NextResponse.json({ entries: latest, total });
  } catch {
    return NextResponse.json(
      { entries: [], total: 0, error: "Failed to read activity log" },
      { status: 500 },
    );
  }
}
