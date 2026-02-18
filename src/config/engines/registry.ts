import type { ModelEngine } from "../types.js";

export interface ComposeRuntimeService {
  image: string;
  container_name: string;
  restart: string;
  ports?: string[];
  volumes?: string[];
  command?: string[];
  deploy?: {
    resources: {
      reservations: {
        devices: Array<{ driver: string; count: string; capabilities: string[] }>;
      };
    };
  };
  devices?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

export interface RuntimeContainerService {
  serviceName: string;
  gatewayRuntimeHost: string;
  dependsOnCondition: "service_started" | "service_healthy";
  service: ComposeRuntimeService;
  volumes?: Record<string, object | null>;
}

interface RuntimeAdapterBuildInput {
  containerPrefix: string;
  configName: string;
  runtime: ModelEngine;
}

export interface RuntimePreGatewayStartInput {
  configName: string;
  deployDir: string;
  runtime: ModelEngine;
  exec: (command: string, args: string[], options?: { cwd?: string }) => Promise<string>;
  logger: {
    step: (message: string) => void;
    success: (message: string) => void;
  };
}

export interface RuntimeEngineAdapter {
  engine: string;
  serviceName: string;
  hostEnvVarName: string;
  defaultPort: number;
  healthProbePaths: string[];
  resolveHostRuntimeUrl: (runtime: ModelEngine) => string;
  buildContainerService: (input: RuntimeAdapterBuildInput) => RuntimeContainerService;
  preGatewayStart?: (input: RuntimePreGatewayStartInput) => Promise<void>;
}

function applyGpuConfig(svc: ComposeRuntimeService, gpu?: string): void {
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

const SGLANG_ADAPTER: RuntimeEngineAdapter = {
  engine: "sglang",
  serviceName: "sglang",
  hostEnvVarName: "SGLANG_HOST",
  defaultPort: 30000,
  healthProbePaths: ["/health", "/v1/models"],
  resolveHostRuntimeUrl: (runtime) => {
    if (runtime.host_url) return runtime.host_url;
    return `http://host.docker.internal:${runtime.port ?? 30000}`;
  },
  buildContainerService: ({ containerPrefix, runtime }) => {
    const port = runtime.port ?? 30000;
    const service: ComposeRuntimeService = {
      image: "lmsysorg/sglang:latest",
      container_name: `${containerPrefix}-sglang`,
      restart: "unless-stopped",
      ports: [`${port}:${port}`],
      command: [
        "python3",
        "-m",
        "sglang.launch_server",
        "--model-path",
        runtime.model ?? "qwen3-32b",
        "--port",
        String(port),
        ...(runtime.quantization ? ["--quantization", runtime.quantization] : []),
      ],
    };
    applyGpuConfig(service, runtime.gpu);
    return {
      serviceName: "sglang",
      gatewayRuntimeHost: "http://sglang:" + port,
      dependsOnCondition: "service_started",
      service,
    };
  },
};

const VLLM_ADAPTER: RuntimeEngineAdapter = {
  engine: "vllm",
  serviceName: "vllm",
  hostEnvVarName: "VLLM_HOST",
  defaultPort: 8000,
  healthProbePaths: ["/health", "/v1/models"],
  resolveHostRuntimeUrl: (runtime) => {
    if (runtime.host_url) return runtime.host_url;
    return `http://host.docker.internal:${runtime.port ?? 8000}`;
  },
  buildContainerService: ({ containerPrefix, runtime }) => {
    const port = runtime.port ?? 8000;
    const service: ComposeRuntimeService = {
      image: "vllm/vllm-openai:latest",
      container_name: `${containerPrefix}-vllm`,
      restart: "unless-stopped",
      ports: [`${port}:${port}`],
      command: ["--model", runtime.model ?? "qwen3-32b", "--port", String(port)],
    };
    applyGpuConfig(service, runtime.gpu);
    return {
      serviceName: "vllm",
      gatewayRuntimeHost: "http://vllm:" + port,
      dependsOnCondition: "service_started",
      service,
    };
  },
};

const OLLAMA_ADAPTER: RuntimeEngineAdapter = {
  engine: "ollama",
  serviceName: "ollama",
  hostEnvVarName: "OLLAMA_HOST",
  defaultPort: 11434,
  healthProbePaths: ["/api/tags"],
  resolveHostRuntimeUrl: (runtime) => {
    if (runtime.host_url) return runtime.host_url;
    return "http://host.docker.internal:11434";
  },
  buildContainerService: ({ containerPrefix, configName, runtime }) => {
    const volumeName = `${configName}-ollama-data`;
    const service: ComposeRuntimeService = {
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
    applyGpuConfig(service, runtime.gpu);
    return {
      serviceName: "ollama",
      gatewayRuntimeHost: "http://ollama:11434",
      dependsOnCondition: "service_healthy",
      service,
      volumes: { [volumeName]: {} },
    };
  },
  preGatewayStart: async ({ configName, deployDir, runtime, exec, logger }) => {
    const model = runtime.model ?? "llama3.3:8b";
    logger.step(`Starting Ollama and pulling model: ${model}...`);
    await exec("docker", ["compose", "up", "-d", "ollama"], {
      cwd: deployDir,
    });
    await exec(
      "docker",
      [
        "exec",
        `clawforce-${configName}-ollama`,
        "ollama",
        "pull",
        model,
      ],
      { cwd: deployDir },
    );
    logger.success("Ollama model ready");
  },
};

const ADAPTERS: Record<string, RuntimeEngineAdapter> = {
  [SGLANG_ADAPTER.engine]: SGLANG_ADAPTER,
  [VLLM_ADAPTER.engine]: VLLM_ADAPTER,
  [OLLAMA_ADAPTER.engine]: OLLAMA_ADAPTER,
};

export function getRuntimeEngineAdapter(engine: string): RuntimeEngineAdapter {
  const adapter = ADAPTERS[engine];
  if (!adapter) {
    throw new Error(
      `Unsupported runtime engine "${engine}". Supported engines: ${Object.keys(ADAPTERS).join(", ")}`,
    );
  }
  return adapter;
}

export function getRuntimeEngineAdapterOrNull(
  engine: string,
): RuntimeEngineAdapter | undefined {
  return ADAPTERS[engine];
}

export function getRuntimeEngineIds(): string[] {
  return Object.keys(ADAPTERS);
}

