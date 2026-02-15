import { stringify as stringifyYaml } from "yaml";
import type { ClawforceConfig } from "./types.js";

interface ComposeService {
  image: string;
  container_name: string;
  restart: string;
  user?: string;
  init?: boolean;
  ports?: string[];
  environment?: string[];
  volumes?: string[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
  volumes?: Record<string, object | null>;
}

export function generateCompose(config: ClawforceConfig): string {
  const containerPrefix = `clawforce-${config.name}`;

  const compose: ComposeConfig = {
    services: {
      "openclaw-gateway": {
        image: "openclaw/openclaw:latest",
        container_name: `${containerPrefix}-gateway`,
        restart: "unless-stopped",
        user: "1000:1000",
        init: true,
        ports: ["18789:18789"],
        environment: [
          "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}",
          "OPENCLAW_GATEWAY_BIND=lan",
          "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}",
          "NODE_ENV=production",
        ],
        volumes: [
          "./config:/home/node/.openclaw",
          "./workspace:/home/node/.openclaw/workspace",
          "./data:/home/node/.openclaw/data",
        ],
        healthcheck: {
          test: [
            "CMD",
            "curl",
            "-sf",
            "http://127.0.0.1:18789/health",
          ],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      },
    },
  };

  if (config.ollama?.enabled) {
    const volumeName = `${config.name}-ollama-data`;

    compose.services["openclaw-gateway"].depends_on = {
      ollama: { condition: "service_healthy" },
    };

    // Add Ollama URL so gateway can find it
    compose.services["openclaw-gateway"].environment!.push(
      "OLLAMA_HOST=http://ollama:11434",
    );

    compose.services.ollama = {
      image: "ollama/ollama:latest",
      container_name: `${containerPrefix}-ollama`,
      restart: "unless-stopped",
      ports: ["11434:11434"],
      volumes: [`${volumeName}:/root/.ollama`],
      healthcheck: {
        test: [
          "CMD",
          "curl",
          "-sf",
          "http://127.0.0.1:11434/api/tags",
        ],
        interval: "10s",
        timeout: "5s",
        retries: 5,
      },
    };

    compose.volumes = { [volumeName]: {} };
  }

  return stringifyYaml(compose, { lineWidth: 0 });
}
