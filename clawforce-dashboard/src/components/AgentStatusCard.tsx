"use client";

import { useEffect, useState } from "react";
import { AgentStatusSkeleton } from "./Skeleton";

interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
}

function parseFriendlyName(containerName: string): string {
  // "clawforce-smoke-test-gateway" → "smoke-test"
  const match = containerName.match(/^clawforce-(.+?)(?:-gateway|-agent|-worker)?$/);
  return match ? match[1] : containerName;
}

export function AgentStatusCard() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        setAgents(data.agents ?? []);
      } catch {
        setAgents([]);
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Agent Status</h2>
        <AgentStatusSkeleton />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Agent Status</h2>
      {agents.length === 0 ? (
        <div className="text-center py-6">
          <svg className="mx-auto h-8 w-8 text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0h.375a2.625 2.625 0 010 5.25H3.375a2.625 2.625 0 010-5.25H3.75" />
          </svg>
          <p className="text-gray-500 text-sm">No agents running</p>
          <p className="text-gray-600 text-xs mt-1">Deploy an agent to see status</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.containerName}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block h-3 w-3 shrink-0 rounded-full ${
                    agent.status === "running"
                      ? "bg-green-500"
                      : agent.status === "unknown"
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                  title={agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                />
                <span className="text-white font-mono text-sm truncate">
                  {parseFriendlyName(agent.containerName)}
                </span>
                <span className={`text-xs ${
                  agent.status === "running"
                    ? "text-green-400"
                    : agent.status === "unknown"
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}>
                  {agent.status}
                </span>
              </div>
              <span className="text-gray-400 text-sm shrink-0 ml-2">{agent.uptime}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
