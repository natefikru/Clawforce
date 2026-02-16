import { NextResponse } from "next/server";
import { getReadDb, resetReadDb } from "@/lib/db";

export async function GET(request: Request) {
  const db = getReadDb();
  if (!db) {
    return NextResponse.json(
      { alerts: [], total: 0, error: "Database unavailable" },
      { status: 503 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 1),
      1000,
    );
    const since = searchParams.get("since");
    const severity = searchParams.get("severity");
    const type = searchParams.get("type");
    const unacknowledgedOnly = searchParams.get("unacknowledgedOnly") === "true";

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (since) {
      conditions.push("ts >= ?");
      params.push(since);
    }
    if (severity) {
      conditions.push("severity = ?");
      params.push(severity);
    }
    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }
    if (unacknowledgedOnly) {
      conditions.push("acknowledged = 0");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const alerts = db
      .prepare(`SELECT * FROM alerts ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit);

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM alerts ${where}`)
      .get(...params) as { total: number };

    return NextResponse.json({ alerts, total: countRow.total });
  } catch {
    resetReadDb();
    return NextResponse.json(
      { alerts: [], total: 0, error: "Failed to query alerts" },
      { status: 500 },
    );
  }
}
