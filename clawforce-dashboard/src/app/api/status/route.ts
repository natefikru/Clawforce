import { NextResponse } from "next/server";
import { getContainerStatus } from "@/lib/container-status";

export type { AgentStatus } from "@/lib/container-status";

export async function GET() {
  try {
    const containers = await getContainerStatus();
    return NextResponse.json({ agents: containers });
  } catch {
    return NextResponse.json({ agents: [], error: "Failed to get status" }, { status: 500 });
  }
}
