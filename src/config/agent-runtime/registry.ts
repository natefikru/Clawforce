import type { AgentRuntime } from "../types.js";
import { OPENCLAW_RUNTIME_ADAPTER } from "./openclaw-adapter.js";
import type { AgentRuntimeAdapter } from "./types.js";

const ADAPTERS: Record<string, AgentRuntimeAdapter> = {
  [OPENCLAW_RUNTIME_ADAPTER.id]: OPENCLAW_RUNTIME_ADAPTER,
};

export function getAgentRuntimeAdapter(runtime: AgentRuntime): AgentRuntimeAdapter {
  const adapter = ADAPTERS[runtime];
  if (!adapter) {
    throw new Error(
      `Unsupported agent runtime "${runtime}". Supported runtimes: ${Object.keys(ADAPTERS).join(", ")}`,
    );
  }
  return adapter;
}

export function getAgentRuntimeIds(): string[] {
  return Object.keys(ADAPTERS);
}
