import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { parseJsonl, getLatestEntries, type ComplianceEntry } from "@/lib/log-parser";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 1000);
  const eventFilter = searchParams.get("event");

  try {
    if (!existsSync(COMPLIANCE_LOG)) {
      return NextResponse.json({ entries: [], total: 0 });
    }

    const content = readFileSync(COMPLIANCE_LOG, "utf8");
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
