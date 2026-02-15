"use client";

import { useEffect, useState } from "react";
import { TaskLogSkeleton } from "./Skeleton";

interface TaskEntry {
  ts: string;
  event: string;
  tool?: string;
  success?: boolean;
  durationMs?: number;
}

export function TaskLog() {
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTasks() {
      try {
        const res = await fetch("/api/activity?event=tool_call&limit=30");
        const data = await res.json();
        setTasks(data.entries ?? []);
      } catch {
        setTasks([]);
      } finally {
        setLoading(false);
      }
    }

    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Task Log</h2>
      {loading ? (
        <TaskLogSkeleton />
      ) : tasks.length === 0 ? (
        <div className="text-center py-6">
          <svg className="mx-auto h-8 w-8 text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
          <p className="text-gray-500 text-sm">No tasks recorded</p>
          <p className="text-gray-600 text-xs mt-1">Tool executions will appear here</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...tasks].reverse().map((task, i) => (
            <div
              key={`${task.ts}-${task.tool}-${i}`}
              className="flex items-center justify-between text-sm border-b border-gray-700 pb-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    task.success ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-gray-300 font-mono">{task.tool}</span>
              </div>
              <span className="text-gray-500 text-xs">
                {task.durationMs ? `${task.durationMs}ms` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
