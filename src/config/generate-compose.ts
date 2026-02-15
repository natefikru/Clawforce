import { stringify as stringifyYaml } from "yaml";
import type { ClawforceConfig } from "./types.js";

interface ComposeService {
  image: string;
  container_name: string;
  restart: string;
  init?: boolean;
  ports?: string[];
  environment?: string[];
  volumes?: string[];
  command?: string[];
  depends_on?: Record<string, { condition: string }>;
  devices?: string[];
  deploy?: {
    resources: {
      reservations: {
        devices: Array<{ driver: string; count: string; capabilities: string[] }>;
      };
    };
  };
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
        image: "openclaw:local",
        container_name: `${containerPrefix}-gateway`,
        restart: "unless-stopped",
        init: true,
        ports: ["18789:18789"],
        environment: [
          "HOME=/home/node",
          "TERM=xterm-256color",
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
        command: [
          "node",
          "dist/index.js",
          "gateway",
          "--bind",
          "lan",
          "--port",
          "18789",
        ],
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

    // GPU passthrough for Ollama
    if (config.ollama.gpu === "nvidia") {
      compose.services.ollama.deploy = {
        resources: {
          reservations: {
            devices: [
              { driver: "nvidia", count: "all", capabilities: ["gpu"] },
            ],
          },
        },
      };
    } else if (config.ollama.gpu === "amd") {
      compose.services.ollama.devices = ["/dev/kfd", "/dev/dri"];
    }

    compose.volumes = { [volumeName]: {} };
  }

  if (config.dashboard && config.dashboard.enabled !== false) {
    const port = config.dashboard.port ?? 3000;

    compose.services.dashboard = {
      image: "clawforce-dashboard:local",
      container_name: `${containerPrefix}-dashboard`,
      restart: "unless-stopped",
      ports: [`${port}:3000`],
      environment: [
        "DATA_DIR=/data",
        "CONFIG_DIR=/config",
      ],
      volumes: [
        "./data:/data:ro",
        "./config:/config:ro",
      ],
    };
  }

  return stringifyYaml(compose, { lineWidth: 0 });
}
