import { generateOpenClawConfig } from "../generate-openclaw.js";
import type { AgentRuntimeAdapter, AgentRuntimeOutput } from "./types.js";

export const OPENCLAW_RUNTIME_ADAPTER: AgentRuntimeAdapter = {
  id: "openclaw",
  generate: (config) => {
    const configMap = generateOpenClawConfig(config);
    const outputs: AgentRuntimeOutput[] = [];
    for (const [instanceName, instanceConfig] of configMap) {
      const filename =
        instanceName === "default"
          ? "openclaw.json"
          : `openclaw-${instanceName}.json`;
      outputs.push({ filename, content: instanceConfig });
    }
    return outputs;
  },
};
