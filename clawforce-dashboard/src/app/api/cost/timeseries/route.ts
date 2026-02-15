import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildTimeSeries, type TimestampedUsage } from "@/lib/cost-explorer";

const CONFIG_DIR = process.env.CONFIG_DIR ?? "/config";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") === "day" ? "day" : "hour";

  try {
    const usages = readTimestampedUsages();
    const timeSeries = buildTimeSeries(usages, bucket);

    return NextResponse.json({ timeSeries, bucket });
  } catch {
    return NextResponse.json(
      { error: "Failed to build time series" },
      { status: 500 },
    );
  }
}

function readTimestampedUsages(): TimestampedUsage[] {
  const sessionsDir = join(CONFIG_DIR, "agents", "main", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const usages: TimestampedUsage[] = [];

  try {
    const files = readdirSync(sessionsDir).filter((f) =>
      f.endsWith(".jsonl"),
    );

    for (const file of files) {
      const content = readFileSync(join(sessionsDir, file), "utf8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.usage && entry.model && entry.timestamp) {
            usages.push({
              model: entry.model,
              inputTokens:
                entry.usage.input_tokens ?? entry.usage.inputTokens ?? 0,
              outputTokens:
                entry.usage.output_tokens ?? entry.usage.outputTokens ?? 0,
              timestamp: entry.timestamp,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Sessions dir might not be accessible
  }

  return usages;
}
