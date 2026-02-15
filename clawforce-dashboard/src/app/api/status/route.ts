import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AgentStatus {
  containerName: string;
  status: "running" | "stopped" | "unknown";
  uptime?: string;
  model?: string;
  channel?: string;
}

export async function GET() {
  try {
    const containers = await getContainerStatus();
    return NextResponse.json({ agents: containers });
  } catch {
    return NextResponse.json({ agents: [], error: "Failed to get status" }, { status: 500 });
  }
}

async function getContainerStatus(): Promise<AgentStatus[]> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "--filter", "name=clawforce",
      "--format", "{{.Names}}|{{.Status}}",
    ], { encoding: "utf8", timeout: 5000 });

    if (!stdout.trim()) return [];

    return stdout
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
