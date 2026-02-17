import { generateOpenClawConfig } from "../generate-openclaw.js";
import type { AgentRuntimeAdapter } from "./types.js";

export const OPENCLAW_RUNTIME_ADAPTER: AgentRuntimeAdapter = {
  id: "openclaw",
  generate: (config) => [
    {
      filename: "openclaw.json",
      content: generateOpenClawConfig(config),
    },
  ],
};
