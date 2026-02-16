import { NextResponse } from "next/server";
import { getWriteDb } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isBusyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /database is locked|sqlite_busy|busy|locked|timeout/i.test(message);
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const alertId = Number.parseInt(id, 10);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json({ error: "Invalid alert ID" }, { status: 400 });
  }

  const db = getWriteDb();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  try {
    const row = db
      .prepare("SELECT acknowledged FROM alerts WHERE id = ?")
      .get(alertId) as { acknowledged: number } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    if (row.acknowledged === 1) {
      return NextResponse.json({ acknowledged: true });
    }

    db.prepare("UPDATE alerts SET acknowledged = 1 WHERE id = ?").run(alertId);
    return NextResponse.json({ acknowledged: true });
  } catch (err) {
    if (isBusyError(err)) {
      return NextResponse.json({ error: "Database busy" }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to acknowledge alert" }, { status: 500 });
  } finally {
    try {
      db.close();
    } catch {
      // Best-effort close
    }
  }
}
