import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseJsonl, getLatestEntries } from "@/lib/log-parser";
import { getReadDb, resetReadDb } from "@/lib/db";
import { auth } from "@/auth";
import {
  buildAgentSqlFilter,
  matchesAgentFilter,
  normalizeAgentId,
} from "@/lib/agent-filter";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 1000);
  const eventFilter = searchParams.get("event");
  const agentFilter = normalizeAgentId(searchParams.get("agentId"));
  const authEnabled = Boolean(process.env.AUTH_SECRET);
  const session = authEnabled ? await auth() : null;
  if (authEnabled && agentFilter && session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Try SQLite first
  const db = getReadDb();
  if (db) {
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (eventFilter) {
        conditions.push("event = ?");
        params.push(eventFilter);
      }
      if (agentFilter) {
        const { clause, params: filterParams } = buildAgentSqlFilter(agentFilter);
        conditions.push(clause);
        params.push(...filterParams);
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
      // Reset cached DB so next request retries the connection
      resetReadDb();
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
    entries = entries.filter((e) => matchesAgentFilter(e as Record<string, unknown>, agentFilter));

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
