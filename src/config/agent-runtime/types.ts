import type { ClawforceConfig } from "../types.js";

export interface AgentRuntimeOutput {
  filename: string;
  content: unknown;
}

export interface AgentRuntimeAdapter {
  id: string;
  generate: (config: ClawforceConfig) => AgentRuntimeOutput[];
}
