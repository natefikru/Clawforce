import { AgentStatusCard } from "@/components/AgentStatusCard";
import { CostTracker } from "@/components/CostTracker";
import { ActivityFeed } from "@/components/ActivityFeed";
import { TaskLog } from "@/components/TaskLog";
import { AlertPanel } from "@/components/AlertPanel";
import { auth, signOut } from "@/auth";

export default async function Dashboard() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Clawforce Dashboard
          </h1>
          <p className="text-gray-400 mt-1">
            AI agent monitoring and cost tracking
          </p>
        </div>
        {session?.user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-300">
              {session.user.name}
              {(session.user as { role?: string }).role && (
                <span className="ml-2 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                  {(session.user as { role?: string }).role}
                </span>
              )}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1 border border-gray-600 rounded hover:border-gray-400"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentStatusCard />
        <CostTracker />
        <ActivityFeed />
        <TaskLog />
        <AlertPanel />
      </div>
    </div>
  );
}
