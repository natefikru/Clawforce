import { stringify as stringifyYaml } from "yaml";
import type { ClawforceConfig, ModelEngine } from "./types.js";
import { getLocalModelEngine } from "./types.js";
import { getRuntimeEngineAdapter } from "./engines/registry.js";

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
  extra_hosts?: string[];
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
  const gatewayPort = config.gateway?.port ?? 18789;
  const gatewayEnv = [
    "HOME=/home/node",
    "TERM=xterm-256color",
    "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}",
    `OPENCLAW_GATEWAY_BIND=${gatewayBind}`,
    "NODE_ENV=production",
  ];

  if (config.auth_profile) {
    gatewayEnv.push("OPENCLAW_AUTH_PROFILE=${OPENCLAW_AUTH_PROFILE}");
  } else {
    // Collect provider keys from cloud models: deduplicate by provider (first part of model id)
    const providerKeyMap = new Map<string, string>();
    for (const m of config.models?.filter((m) => m.type === "cloud" && m.api_key) ?? []) {
      const provider = m.id.split("/")[0];
      if (!providerKeyMap.has(provider)) {
        providerKeyMap.set(provider, m.api_key!);
      }
    }
    const providers = [...providerKeyMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const provider of providers) {
      gatewayEnv.push(`${toProviderApiKeyEnvName(provider)}=\${${toProviderApiKeyEnvName(provider)}}`);
    }
  }

  if (config.alerts?.notifications?.email?.password) {
    gatewayEnv.push("CLAWFORCE_ALERTS_EMAIL_PASSWORD=${CLAWFORCE_ALERTS_EMAIL_PASSWORD}");
  }

  const compose: ComposeConfig = {
    services: {
      "openclaw-gateway": {
        image: "openclaw:local",
        container_name: `${containerPrefix}-gateway`,
        restart: "unless-stopped",
        init: true,
        ports: [`${gatewayPort}:${gatewayPort}`],
        environment: gatewayEnv,
        volumes: [
          "./config:/home/node/.openclaw",
          "./workspace:/home/node/.openclaw/workspace",
          "./data:/home/node/.openclaw/data",
          ...config.agents.map((agent) =>
            `${agent.workspace}:/home/node/.openclaw/workspace/${agent.name}`
          ),
        ],
        command: [
          "node",
          "dist/index.js",
          "gateway",
          "--bind",
          gatewayBind,
          "--port",
          String(gatewayPort),
        ],
      },
    },
  };

  const localEngine: ModelEngine | undefined = getLocalModelEngine(config);

  if (localEngine) {
    const engine = localEngine.runtime ?? "sglang";
    const adapter = getRuntimeEngineAdapter(engine);
    const runtimeLocation = localEngine.location ?? "container";

    if (runtimeLocation === "host") {
      const hostRuntimeUrl = adapter.resolveHostRuntimeUrl(localEngine as never);
      if (hostRuntimeUrl.includes("host.docker.internal")) {
        compose.services["openclaw-gateway"].extra_hosts = [
          ...(compose.services["openclaw-gateway"].extra_hosts ?? []),
          "host.docker.internal:host-gateway",
        ];
      }
    } else {
      const runtimeService = adapter.buildContainerService({
        containerPrefix,
        configName: config.name,
        runtime: localEngine as never,
      });
      compose.services["openclaw-gateway"].depends_on = {
        [runtimeService.serviceName]: { condition: runtimeService.dependsOnCondition },
      };
      compose.services[runtimeService.serviceName] = runtimeService.service as ComposeService;
      compose.volumes = {
        ...(compose.volumes ?? {}),
        ...(runtimeService.volumes ?? {}),
      };
      compose.services["openclaw-gateway"].environment!.push(
        `${adapter.hostEnvVarName}=${runtimeService.gatewayRuntimeHost}`,
      );
    }

    if (runtimeLocation === "host") {
      compose.services["openclaw-gateway"].environment!.push(
        `${adapter.hostEnvVarName}=${adapter.resolveHostRuntimeUrl(localEngine as never)}`,
      );
    }
  }

  if (config.dashboard && config.dashboard.enabled !== false) {
    const port = config.dashboard.port ?? 3000;

    const dashboardEnv = [
      "DATA_DIR=/data",
      "CONFIG_DIR=/config",
      `OPENCLAW_GATEWAY_URL=ws://openclaw-gateway:${gatewayPort}`,
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

function toProviderApiKeyEnvName(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
