import { NextResponse, type NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  calculateCostBreakdown,
  formatCost,
  type TokenUsage,
} from "@/lib/cost-calculator";
import { parseJsonl, getModelUsage } from "@/lib/log-parser";
import { calculateWhatIf } from "@/lib/cost-explorer";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const CONFIG_DIR = process.env.CONFIG_DIR ?? "/config";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const localPercentParam = searchParams.get("localPercent");

  try {
    // Try to read token usage from session transcripts
    const usages = readSessionUsages();

    // If no session data, fall back to compliance log model usage
    if (usages.length === 0) {
      const modelCounts = readModelUsageFromCompliance();
      return NextResponse.json({
        totalCost: formatCost(0),
        cloudCost: formatCost(0),
        localCost: formatCost(0),
        savingsPercent: 0,
        modelUsage: modelCounts,
        source: "compliance",
      });
    }

    const breakdown = calculateCostBreakdown(usages);

    const response: Record<string, unknown> = {
      totalCost: formatCost(breakdown.totalCost),
      cloudCost: formatCost(breakdown.cloudCost),
      localCost: formatCost(breakdown.localCost),
      savingsPercent: breakdown.savingsPercent,
      cloudRequests: breakdown.cloudRequests,
      localRequests: breakdown.localRequests,
      perModel: Object.fromEntries(
        Object.entries(breakdown.perModel).map(([model, data]) => [
          model,
          { cost: formatCost(data.cost), requests: data.requests },
        ]),
      ),
      source: "sessions",
    };

    // Include what-if projection when localPercent is requested
    if (localPercentParam !== null) {
      const percent = Math.max(0, Math.min(100, parseInt(localPercentParam) || 0));
      const whatIf = calculateWhatIf(usages, { type: "localPercent", percent });
      response.whatIf = {
        projectedCost: formatCost(whatIf.projectedCost),
        projectedSavings: whatIf.savingsPercent,
        currentCost: formatCost(whatIf.currentCost),
      };
    }

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: "Failed to calculate costs" },
      { status: 500 },
    );
  }
}

function readSessionUsages(): TokenUsage[] {
  const sessionsDir = join(CONFIG_DIR, "agents", "main", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const usages: TokenUsage[] = [];

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
          if (entry.usage && entry.model) {
            usages.push({
              model: entry.model,
              inputTokens: entry.usage.input_tokens ?? entry.usage.inputTokens ?? 0,
              outputTokens: entry.usage.output_tokens ?? entry.usage.outputTokens ?? 0,
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

function readModelUsageFromCompliance(): Record<string, number> {
  if (!existsSync(COMPLIANCE_LOG)) return {};

  try {
    const content = readFileSync(COMPLIANCE_LOG, "utf8");
    const entries = parseJsonl(content);
    return getModelUsage(entries);
  } catch {
    return {};
  }
}
