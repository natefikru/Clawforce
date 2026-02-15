"use client";

import { useEffect, useState } from "react";

interface ActivityEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

const EVENT_COLORS: Record<string, string> = {
  tool_call: "text-blue-400",
  message_received: "text-yellow-400",
  message_sent: "text-green-400",
  routing_decision: "text-purple-400",
};

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
  try {
    const date = new Date(ts);
    return date.toLocaleTimeString();
  } catch {
    return ts;
  }
}

export function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch("/api/activity?limit=50");
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }

    fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Activity Feed
        </h2>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white">Activity Feed</h2>
        {total > 0 && (
          <span className="text-sm text-gray-400">{total} total events</span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="text-gray-400">No activity recorded</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...entries].reverse().map((entry, i) => (
            <div key={i} className="text-sm border-b border-gray-700 pb-2">
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
