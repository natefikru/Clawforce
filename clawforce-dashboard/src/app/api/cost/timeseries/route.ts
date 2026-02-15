import { NextRequest, NextResponse } from "next/server";
import { formatCost } from "@/lib/cost-explorer";
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
};

export async function GET(req: NextRequest) {
  if (!process.env.OPENCLAW_GATEWAY_URL) {
    return NextResponse.json(
      { error: "OPENCLAW_GATEWAY_URL not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "30") || 30));

  try {
    const summary = await gatewayRequest<GatewayCostSummary>("usage.cost", {
      days,
    });

    const timeSeries = summary.daily.map((day) => ({
      timestamp: day.date,
      cloudCost: formatCost(
        day.inputCost + day.outputCost + day.cacheReadCost + day.cacheWriteCost,
      ),
      totalRequests: day.totalTokens > 0 ? 1 : 0,
    }));

    return NextResponse.json({ timeSeries, bucket: "day" });
  } catch {
    return NextResponse.json(
      { error: "Gateway unavailable" },
      { status: 503 },
    );
  }
}
