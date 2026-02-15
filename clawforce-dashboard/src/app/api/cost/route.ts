import { NextResponse, type NextRequest } from "next/server";
import { formatCost, calculateWhatIf, type CostEntry } from "@/lib/cost-explorer";
import { gatewayRequest } from "@/lib/gateway-client";

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
  entries?: CostEntry[];
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const localPercentParam = searchParams.get("localPercent");

  if (!process.env.OPENCLAW_GATEWAY_URL) {
    return NextResponse.json(
      { error: "OPENCLAW_GATEWAY_URL not configured" },
      { status: 503 },
    );
  }

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

    if (localPercentParam !== null && summary.entries && summary.entries.length > 0) {
      const percent = Math.max(
        0,
        Math.min(100, parseInt(localPercentParam) || 0),
      );
      const whatIf = calculateWhatIf(summary.entries, {
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
  } catch {
    return NextResponse.json(
      { error: "Gateway unavailable" },
      { status: 503 },
    );
  }
}
