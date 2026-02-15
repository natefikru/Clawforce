"use client";

import { useEffect, useState } from "react";

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

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Task Log</h2>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Task Log</h2>
      {tasks.length === 0 ? (
        <div className="text-gray-400">No tasks recorded</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...tasks].reverse().map((task, i) => (
            <div
              key={i}
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
