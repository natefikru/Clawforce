import { AgentStatusCard } from "@/components/AgentStatusCard";
import { CostTracker } from "@/components/CostTracker";
import { ActivityFeed } from "@/components/ActivityFeed";
import { TaskLog } from "@/components/TaskLog";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">Clawforce Dashboard</h1>
        <p className="text-gray-400 mt-1">
          AI agent monitoring and cost tracking
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentStatusCard />
        <CostTracker />
        <ActivityFeed />
        <TaskLog />
      </div>
    </div>
  );
}
