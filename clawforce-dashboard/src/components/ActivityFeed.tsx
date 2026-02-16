"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { ActivityFeedSkeleton } from "./Skeleton";

interface ActivityEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

interface CostData {
  spent: number;
  requestCount: number;
}

interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
}

interface StatusData {
  agents: AgentStatus[];
}

const EVENT_COLORS: Record<string, string> = {
  tool_call: "text-blue-400",
  message_received: "text-yellow-400",
  message_sent: "text-green-400",
  routing_decision: "text-purple-400",
};

const MAX_ENTRIES = 200;
const LOADING_TIMEOUT_MS = 4000;

function formatEntry(entry: ActivityEntry): string {
  switch (entry.event) {
    case "tool_call":
      return `${entry.tool} ${entry.success ? "OK" : "ERR"}${entry.durationMs ? ` (${entry.durationMs}ms)` : ""}`;
    case "message_received":
      return `from ${entry.from ?? "unknown"} via ${entry.channel ?? "unknown"} (${entry.contentLength ?? 0} chars)`;
    case "message_sent":
      return `to ${entry.to ?? "unknown"} via ${entry.channel ?? "unknown"} (model: ${entry.model ?? "unknown"})`;
    case "routing_decision":
      return `→ ${entry.model} (${entry.reason})`;
    default:
      return JSON.stringify(entry);
  }
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString();
}

export function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(false);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [agentStatus, setAgentStatus] = useState<StatusData | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=50");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
      setError(false);
    } catch {
      setEntries([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    fetchActivity();
    pollIntervalRef.current = setInterval(fetchActivity, 5000);
  }, [fetchActivity]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    // Timeout: if still loading after LOADING_TIMEOUT_MS, stop showing skeleton
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, LOADING_TIMEOUT_MS);

    try {
      eventSource = new EventSource("/api/activity/stream");
      setStreaming(true);

      // Named event: activity — individual compliance events
      eventSource.addEventListener("activity", (event) => {
        try {
          const entry = JSON.parse(event.data) as ActivityEntry;
          setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
          setTotal((prev) => prev + 1);
          setLoading(false);
          setError(false);
          clearTimeout(loadingTimeout);
        } catch {
          // Ignore parse errors
        }
      });

      // Named event: cost — budget state updates
      eventSource.addEventListener("cost", (event) => {
        try {
          const cost = JSON.parse(event.data) as CostData;
          setCostData(cost);
        } catch {
          // Ignore parse errors
        }
      });

      // Named event: status — Docker container state changes
      eventSource.addEventListener("status", (event) => {
        try {
          const status = JSON.parse(event.data) as StatusData;
          setAgentStatus(status);
        } catch {
          // Ignore parse errors
        }
      });

      // Named event: sync — reconnection truncation, reset and refetch
      eventSource.addEventListener("sync", () => {
        setTotal(0);
        fetchActivity();
      });

      eventSource.onerror = () => {
        eventSource?.close();
        setStreaming(false);
        clearTimeout(loadingTimeout);
        startPolling();
      };
    } catch {
      setStreaming(false);
      clearTimeout(loadingTimeout);
      startPolling();
    }

    return () => {
      clearTimeout(loadingTimeout);
      eventSource?.close();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [startPolling, fetchActivity]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white">Activity Feed</h2>
        <div className="flex items-center gap-2">
          {streaming && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
          {costData && (
            <span className="text-xs text-gray-400">
              ${costData.spent.toFixed(4)} ({costData.requestCount} reqs)
            </span>
          )}
          {agentStatus && agentStatus.agents.length > 0 && (
            <span className="text-xs text-gray-400">
              {agentStatus.agents.filter((a) => a.status === "running").length}/{agentStatus.agents.length} agents
            </span>
          )}
          {total > 0 && (
            <span className="text-sm text-gray-400">{total} total events</span>
          )}
        </div>
      </div>

      {loading ? (
        <ActivityFeedSkeleton />
      ) : error ? (
        <div className="text-center py-6">
          <p className="text-gray-500 text-sm mb-2">Failed to load activity data</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(false);
              fetchActivity();
            }}
            className="text-sm text-green-400 hover:text-green-300 underline focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:outline-none rounded px-1"
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-6">
          <svg className="mx-auto h-8 w-8 text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 12.677a2.25 2.25 0 00-.1.661z" />
          </svg>
          <p className="text-gray-500 text-sm">No activity yet</p>
          <p className="text-gray-600 text-xs mt-1">Events will appear here as the agent processes requests</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...entries].reverse().map((entry, i) => (
            <div key={`${entry.ts}-${entry.event}-${i}`} className="text-sm border-b border-gray-700 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-mono text-xs">
                  {formatTime(entry.ts)}
                </span>
                <span
                  className={`font-medium ${EVENT_COLORS[entry.event] ?? "text-gray-300"}`}
                >
                  {entry.event}
                </span>
              </div>
              <div className="text-gray-400 ml-16 text-xs">
                {formatEntry(entry)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
