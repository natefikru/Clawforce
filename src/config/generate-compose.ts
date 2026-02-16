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
  const gatewayBind = config.gateway?.bind ?? "loopback";

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
          `OPENCLAW_GATEWAY_BIND=${gatewayBind}`,
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
          gatewayBind,
          "--port",
          "18789",
        ],
      },
    },
  };

  if (config.runtime) {
    const rt = config.runtime;
    const engine = rt.engine ?? "sglang";
    const serviceName = engine === "ollama" ? "ollama" : engine;

    if (engine === "sglang") {
      const port = rt.port ?? 30000;
      compose.services["openclaw-gateway"].depends_on = {
        [serviceName]: { condition: "service_started" },
      };
      compose.services["openclaw-gateway"].environment!.push(
        `SGLANG_HOST=http://${serviceName}:${port}`,
      );

      const svc: ComposeService = {
        image: "lmsysorg/sglang:latest",
        container_name: `${containerPrefix}-sglang`,
        restart: "unless-stopped",
        ports: [`${port}:${port}`],
        command: [
          "python3", "-m", "sglang.launch_server",
          "--model-path", rt.model ?? "qwen3-32b",
          "--port", String(port),
          ...(rt.quantization ? ["--quantization", rt.quantization] : []),
        ],
      };

      applyGpuConfig(svc, rt.gpu);
      compose.services[serviceName] = svc;
    } else if (engine === "vllm") {
      const port = rt.port ?? 8000;
      compose.services["openclaw-gateway"].depends_on = {
        [serviceName]: { condition: "service_started" },
      };
      compose.services["openclaw-gateway"].environment!.push(
        `VLLM_HOST=http://${serviceName}:${port}`,
      );

      const svc: ComposeService = {
        image: "vllm/vllm-openai:latest",
        container_name: `${containerPrefix}-vllm`,
        restart: "unless-stopped",
        ports: [`${port}:${port}`],
        command: ["--model", rt.model ?? "qwen3-32b", "--port", String(port)],
      };

      applyGpuConfig(svc, rt.gpu);
      compose.services[serviceName] = svc;
    } else {
      // runtime.engine === "ollama" — use same logic as legacy ollama section
      addOllamaService(compose, containerPrefix, config.name, rt.model ?? "llama3.3:8b", rt.gpu);
    }
  } else if (config.ollama?.enabled) {
    addOllamaService(compose, containerPrefix, config.name, config.ollama.model, config.ollama.gpu);
  }

  if (config.dashboard && config.dashboard.enabled !== false) {
    const port = config.dashboard.port ?? 3000;

    const dashboardEnv = [
      "DATA_DIR=/data",
      "CONFIG_DIR=/config",
      "OPENCLAW_GATEWAY_URL=ws://openclaw-gateway:18789",
      "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}",
    ];

    if (config.dashboard!.auth?.enabled) {
      dashboardEnv.push("AUTH_SECRET=${AUTH_SECRET}");
      dashboardEnv.push("AUTH_TRUST_HOST=true");
    }

    compose.services.dashboard = {
      image: "clawforce-dashboard:local",
      container_name: `${containerPrefix}-dashboard`,
      restart: "unless-stopped",
      ports: [`${port}:3000`],
      environment: dashboardEnv,
      volumes: [
        "./data:/data:ro",
        "./config:/config:ro",
      ],
      depends_on: {
        "openclaw-gateway": { condition: "service_started" },
      },
    };
  }

  return stringifyYaml(compose, { lineWidth: 0 });
}

function applyGpuConfig(svc: ComposeService, gpu?: string): void {
  if (gpu === "nvidia") {
    svc.deploy = {
      resources: {
        reservations: {
          devices: [{ driver: "nvidia", count: "all", capabilities: ["gpu"] }],
        },
      },
    };
  } else if (gpu === "amd") {
    svc.devices = ["/dev/kfd", "/dev/dri"];
  }
}

function addOllamaService(
  compose: ComposeConfig,
  containerPrefix: string,
  configName: string,
  _model?: string,
  gpu?: string,
): void {
  const volumeName = `${configName}-ollama-data`;

  compose.services["openclaw-gateway"].depends_on = {
    ollama: { condition: "service_healthy" },
  };

  compose.services["openclaw-gateway"].environment!.push(
    "OLLAMA_HOST=http://ollama:11434",
  );

  const svc: ComposeService = {
    image: "ollama/ollama:latest",
    container_name: `${containerPrefix}-ollama`,
    restart: "unless-stopped",
    ports: ["11434:11434"],
    volumes: [`${volumeName}:/root/.ollama`],
    healthcheck: {
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:11434/api/tags"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
    },
  };

  applyGpuConfig(svc, gpu);
  compose.services.ollama = svc;
  compose.volumes = { ...compose.volumes, [volumeName]: {} };
}
