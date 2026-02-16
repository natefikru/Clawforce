"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface AlertRow {
  id: number;
  ts: string;
  severity: "info" | "warning" | "error" | string;
  type: string;
  agent_id: string | null;
  message: string;
  acknowledged: number;
  data: string | null;
  agentId?: string;
}

function severityClass(severity: string): string {
  if (severity === "error") return "text-red-300 bg-red-900/30 border-red-700";
  if (severity === "warning") return "text-yellow-300 bg-yellow-900/30 border-yellow-700";
  return "text-blue-300 bg-blue-900/30 border-blue-700";
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

export function AlertPanel() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts?unacknowledgedOnly=true&limit=50");
      if (!res.ok) throw new Error("Failed to fetch alerts");
      const payload = await res.json();
      setAlerts((payload.alerts ?? []) as AlertRow[]);
      setError(null);
    } catch {
      setError("Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    const eventSource = new EventSource("/api/activity/stream");
    eventSource.addEventListener("alert", (event) => {
      try {
        const incoming = JSON.parse(event.data) as AlertRow;
        setAlerts((prev) => {
          const deduped = prev.filter((a) => a.id !== incoming.id);
          return [incoming, ...deduped].slice(0, 100);
        });
      } catch {
        // Ignore malformed SSE alert events
      }
    });
    eventSource.onerror = () => {
      eventSource.close();
    };
    return () => {
      eventSource.close();
    };
  }, []);

  const acknowledge = useCallback(async (id: number) => {
    const res = await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
    if (!res.ok) return;
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const unacknowledgedCount = useMemo(
    () => alerts.filter((a) => a.acknowledged === 0).length,
    [alerts],
  );

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white">Alerts</h2>
        <span className="text-xs text-gray-400">
          {unacknowledgedCount} unacknowledged
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading alerts...</p>
      ) : error ? (
        <div className="text-sm text-gray-400">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchAlerts()}
            className="mt-2 text-green-400 hover:text-green-300 underline"
          >
            Retry
          </button>
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-gray-500">No active alerts</p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {alerts.map((alert) => {
            // JSONL fallback uses agentId while SQLite rows use agent_id.
            const agent = alert.agent_id ?? alert.agentId;
            return (
              <div
                key={alert.id}
                className={`rounded border p-3 ${severityClass(alert.severity)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {alert.type}
                      {agent ? ` (${agent})` : ""}
                    </p>
                    <p className="text-xs mt-1">{alert.message}</p>
                    <p className="text-[11px] mt-2 opacity-80">{formatTime(alert.ts)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void acknowledge(alert.id)}
                    className="text-xs px-2 py-1 rounded border border-gray-500 text-gray-200 hover:bg-gray-700"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
