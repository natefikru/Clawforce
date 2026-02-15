import { NextResponse } from "next/server";
import { execSync } from "node:child_process";

export interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
  model?: string;
  channel?: string;
}

export async function GET() {
  try {
    const containers = getContainerStatus();
    return NextResponse.json({ agents: containers });
  } catch {
    return NextResponse.json({ agents: [], error: "Failed to get status" }, { status: 500 });
  }
}

function getContainerStatus(): AgentStatus[] {
  try {
    const output = execSync(
      'docker ps --filter "name=clawforce" --format "{{.Names}}|{{.Status}}"',
      { encoding: "utf8", timeout: 5000 },
    );

    if (!output.trim()) return [];

    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, status] = line.split("|");
        return {
          containerName: name,
          status: status?.includes("Up") ? "running" as const : "stopped" as const,
          uptime: status,
        };
      });
  } catch {
    return [];
  }
}
