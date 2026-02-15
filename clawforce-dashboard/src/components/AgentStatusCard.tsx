"use client";

import { useEffect, useState } from "react";
import { AgentStatusSkeleton } from "./Skeleton";

interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
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
        <div className="text-gray-500 text-sm text-center py-6">No agents running</div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.containerName}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    agent.status === "running"
                      ? "bg-green-500"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-white font-mono text-sm">
                  {agent.containerName}
                </span>
              </div>
              <span className="text-gray-400 text-sm">{agent.uptime}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
