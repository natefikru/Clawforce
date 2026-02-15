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
import { gatewayRequest } from "@/lib/gateway-client";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const CONFIG_DIR = process.env.CONFIG_DIR ?? "/config";
const COMPLIANCE_LOG = `${DATA_DIR}/compliance.jsonl`;

type CostUsageTotals = {
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
};

type GatewayCostSummary = {
  updatedAt: number;
  days: number;
  daily: Array<CostUsageTotals & { date: string }>;
  totals: CostUsageTotals;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const localPercentParam = searchParams.get("localPercent");

  try {
    // Try gateway first (authoritative cost data, no hardcoded pricing)
    const gatewayResult = await tryGateway(localPercentParam);
    if (gatewayResult) return gatewayResult;

    // Fallback: read from local files with hardcoded pricing
    return fallbackToFiles(localPercentParam);
  } catch {
    return NextResponse.json(
      { error: "Failed to calculate costs" },
      { status: 500 },
    );
  }
}

async function tryGateway(
  localPercentParam: string | null,
): Promise<NextResponse | null> {
  if (!process.env.OPENCLAW_GATEWAY_URL) return null;

  try {
    const summary = await gatewayRequest<GatewayCostSummary>("usage.cost", {
      days: 30,
    });

    const response: Record<string, unknown> = {
      totalCost: formatCost(summary.totals.totalCost),
      cloudCost: formatCost(
        summary.totals.inputCost +
          summary.totals.outputCost +
          summary.totals.cacheReadCost +
          summary.totals.cacheWriteCost,
      ),
      localCost: formatCost(0),
      savingsPercent: 0,
      perModel: {},
      source: "gateway",
    };

    // What-if projections still use local file data (gateway doesn't support this)
    if (localPercentParam !== null) {
      const usages = readSessionUsages();
      if (usages.length > 0) {
        const percent = Math.max(
          0,
          Math.min(100, parseInt(localPercentParam) || 0),
        );
        const whatIf = calculateWhatIf(usages, {
          type: "localPercent",
          percent,
        });
        response.whatIf = {
          projectedCost: formatCost(whatIf.projectedCost),
          projectedSavings: whatIf.savingsPercent,
          currentCost: formatCost(whatIf.currentCost),
        };
      }
    }

    return NextResponse.json(response);
  } catch {
    // Gateway unavailable, fall through to file-based
    return null;
  }
}

function fallbackToFiles(
  localPercentParam: string | null,
): NextResponse {
  const usages = readSessionUsages();

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

  if (localPercentParam !== null) {
    const percent = Math.max(
      0,
      Math.min(100, parseInt(localPercentParam) || 0),
    );
    const whatIf = calculateWhatIf(usages, {
      type: "localPercent",
      percent,
    });
    response.whatIf = {
      projectedCost: formatCost(whatIf.projectedCost),
      projectedSavings: whatIf.savingsPercent,
      currentCost: formatCost(whatIf.currentCost),
    };
  }

  return NextResponse.json(response);
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
