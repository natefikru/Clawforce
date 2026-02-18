import { stringify as stringifyYaml } from "yaml";
import type { ClawforceConfig } from "./types.js";
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
  const models = config.models;
  const credentialMode = models.credential_mode ?? "env";
  const gatewayEnv = [
    "HOME=/home/node",
    "TERM=xterm-256color",
    "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}",
    `OPENCLAW_GATEWAY_BIND=${gatewayBind}`,
    "NODE_ENV=production",
  ];

  if (credentialMode === "auth_profile") {
    gatewayEnv.push("OPENCLAW_AUTH_PROFILE=${OPENCLAW_AUTH_PROFILE}");
  } else {
    const providerKeys = Object.keys(models.provider_keys ?? {}).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const provider of providerKeys) {
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
        ports: ["18789:18789"],
        environment: gatewayEnv,
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

  if (config.local_model) {
    const rt = config.local_model;
    const engine = rt.engine ?? "sglang";
    const adapter = getRuntimeEngineAdapter(engine);
    const runtimeLocation = rt.location ?? "container";

    if (runtimeLocation === "host") {
      const hostRuntimeUrl = adapter.resolveHostRuntimeUrl(rt);
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
        runtime: rt,
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
        `${adapter.hostEnvVarName}=${adapter.resolveHostRuntimeUrl(rt)}`,
      );
    }
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

function toProviderApiKeyEnvName(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
