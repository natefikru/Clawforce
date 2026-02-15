"use client";

import { useEffect, useState } from "react";

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

export function CostTracker() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost Tracker</h2>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost Tracker</h2>
        <div className="text-gray-400">No cost data available</div>
      </div>
    );
  }

  const totalRequests = (data.cloudRequests ?? 0) + (data.localRequests ?? 0);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Cost Tracker</h2>

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
            <div
              key={model}
              className="flex justify-between text-sm"
            >
              <span className="text-gray-300 font-mono truncate">
                {model}
              </span>
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
            <div
              key={model}
              className="flex justify-between text-sm"
            >
              <span className="text-gray-300 font-mono truncate">
                {model}
              </span>
              <span className="text-gray-400 ml-2">{count} routing decisions</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
