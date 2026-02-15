"use client";

import { useEffect, useState } from "react";
import { CostTrackerSkeleton } from "./Skeleton";

interface CostData {
  totalCost: string;
  cloudCost: string;
  localCost: string;
  savingsPercent: number;
  cloudRequests?: number;
  localRequests?: number;
  perModel?: Record<string, { cost: string; requests: number }>;
  modelUsage?: Record<string, number>;
  source: string;
}

interface TimeSeriesPoint {
  timestamp: string;
  cloudCost: number;
  localCost: number;
  totalRequests: number;
}

interface WhatIfData {
  projectedCost: string;
  projectedSavings: number;
  currentCost: string;
}

interface WhatIfState {
  localPercent: number;
  data: WhatIfData | null;
  loading: boolean;
}

type Tab = "summary" | "timeline" | "whatif";

export function CostTracker() {
  const [data, setData] = useState<CostData | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [whatIf, setWhatIf] = useState<WhatIfState>({
    localPercent: 50,
    data: null,
    loading: false,
  });

  useEffect(() => {
    async function fetchCost() {
      try {
        const res = await fetch("/api/cost");
        const json = await res.json();
        setData(json);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchCost();
    const interval = setInterval(fetchCost, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab !== "timeline") return;
    async function fetchTimeSeries() {
      try {
        const res = await fetch("/api/cost/timeseries?bucket=hour");
        const json = await res.json();
        setTimeSeries(json.timeSeries ?? []);
      } catch {
        setTimeSeries([]);
      }
    }
    fetchTimeSeries();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "whatif") return;
    const controller = new AbortController();
    setWhatIf((prev) => ({ ...prev, loading: true }));

    async function fetchWhatIf() {
      try {
        const res = await fetch(
          `/api/cost?localPercent=${whatIf.localPercent}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        setWhatIf((prev) => ({
          ...prev,
          data: json.whatIf ?? null,
          loading: false,
        }));
      } catch {
        if (!controller.signal.aborted) {
          setWhatIf((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    const debounce = setTimeout(fetchWhatIf, 300);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [activeTab, whatIf.localPercent]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost Tracker</h2>
        <CostTrackerSkeleton />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost Tracker</h2>
        <div className="text-gray-500 text-sm text-center py-6">No cost data available</div>
      </div>
    );
  }

  const totalRequests = (data.cloudRequests ?? 0) + (data.localRequests ?? 0);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white">Cost Tracker</h2>
        <div className="flex gap-1" role="tablist">
          {(["summary", "timeline", "whatif"] as Tab[]).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm rounded transition-colors focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:outline-none ${
                activeTab === tab
                  ? "bg-gray-600 text-white font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
              }`}
            >
              {tab === "whatif" ? "What If" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "summary" && (
        <SummaryView data={data} totalRequests={totalRequests} />
      )}

      {activeTab === "timeline" && (
        <TimelineView timeSeries={timeSeries} />
      )}

      {activeTab === "whatif" && (
        <WhatIfView
          whatIf={whatIf}
          onPercentChange={(percent) =>
            setWhatIf({ ...whatIf, localPercent: percent, data: null })
          }
          currentSavings={data.savingsPercent}
        />
      )}
    </div>
  );
}

function SummaryView({
  data,
  totalRequests,
}: {
  data: CostData;
  totalRequests: number;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-sm text-gray-400">Total Cost</div>
          <div className="text-2xl font-bold text-white">{data.totalCost}</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">Savings</div>
          <div className="text-2xl font-bold text-green-400">
            {data.savingsPercent}%
          </div>
        </div>
      </div>

      {totalRequests > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Cloud: {data.cloudRequests}</span>
            <span>Local: {data.localRequests}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{
                width: `${data.localRequests ? (data.localRequests / totalRequests) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {data.perModel && Object.keys(data.perModel).length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-400">Per Model</div>
          {Object.entries(data.perModel).map(([model, info]) => (
            <div key={model} className="flex justify-between text-sm">
              <span className="text-gray-300 font-mono truncate">{model}</span>
              <span className="text-gray-400 ml-2">
                {info.cost} ({info.requests} req)
              </span>
            </div>
          ))}
        </div>
      )}

      {data.modelUsage && Object.keys(data.modelUsage).length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-400">Model Usage</div>
          {Object.entries(data.modelUsage).map(([model, count]) => (
            <div key={model} className="flex justify-between text-sm">
              <span className="text-gray-300 font-mono truncate">{model}</span>
              <span className="text-gray-400 ml-2">
                {count} routing decisions
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TimelineView({ timeSeries }: { timeSeries: TimeSeriesPoint[] }) {
  if (timeSeries.length === 0) {
    return <div className="text-gray-400 text-sm">No timeline data available</div>;
  }

  const maxCost = Math.max(
    ...timeSeries.map((p) => p.cloudCost + p.localCost),
    0.01,
  );

  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-400 mb-2">Cost over time (per hour)</div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {timeSeries.map((point) => {
          const total = point.cloudCost + point.localCost;
          const widthPercent = (total / maxCost) * 100;
          const cloudPercent =
            total > 0 ? (point.cloudCost / total) * 100 : 0;

          return (
            <div key={point.timestamp} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-mono w-20 shrink-0">
                {formatTimestamp(point.timestamp)}
              </span>
              <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full flex"
                  style={{ width: `${widthPercent}%` }}
                >
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${cloudPercent}%` }}
                  />
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${100 - cloudPercent}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-gray-400 w-16 text-right">
                ${total.toFixed(4)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 text-xs text-gray-500 mt-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-blue-500 rounded-full" />
          Cloud
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full" />
          Local
        </span>
      </div>
    </div>
  );
}

function WhatIfView({
  whatIf,
  onPercentChange,
  currentSavings,
}: {
  whatIf: WhatIfState;
  onPercentChange: (percent: number) => void;
  currentSavings: number;
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-400">
        What if you routed more requests to local models?
      </div>

      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">Local routing</span>
          <span className="text-white font-medium">{whatIf.localPercent}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={whatIf.localPercent}
          onChange={(e) => onPercentChange(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0% (all cloud)</span>
          <span>100% (all local)</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="bg-gray-700/50 rounded p-3">
          <div className="text-xs text-gray-400">Current savings</div>
          <div className="text-lg font-bold text-white">{currentSavings}%</div>
        </div>
        <div className="bg-gray-700/50 rounded p-3">
          <div className="text-xs text-gray-400">Projected savings</div>
          <div className="text-lg font-bold text-green-400">
            {whatIf.loading ? (
              <span className="inline-block w-10 h-5 bg-gray-700 rounded animate-pulse" />
            ) : whatIf.data ? (
              `${whatIf.data.projectedSavings}%`
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      {whatIf.data && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-700/50 rounded p-3">
            <div className="text-xs text-gray-400">Current cost</div>
            <div className="text-sm font-medium text-white">
              {whatIf.data.currentCost}
            </div>
          </div>
          <div className="bg-gray-700/50 rounded p-3">
            <div className="text-xs text-gray-400">Projected cost</div>
            <div className="text-sm font-medium text-green-400">
              {whatIf.data.projectedCost}
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Projections based on actual usage data. The most expensive cloud
        requests are routed to local models first for maximum savings.
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (isNaN(date.getTime())) {
    return ts.slice(11, 16);
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
