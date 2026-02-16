import { isLocalModel } from "../../shared/pricing.js";

export type FailoverPolicy = "block" | "queue" | "failover-safe";
export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";
export type CircuitState = "closed" | "open" | "half_open";
export type LocalProvider = "ollama" | "sglang" | "vllm";

export interface HealthCheckConfig {
  enabled: boolean;
  intervalSeconds: number;
  timeoutSeconds: number;
  staleAfterSeconds: number;
  failoverPolicy: FailoverPolicy;
  failureThreshold: number;
  recoveryThreshold: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface ProviderHealthState {
  provider: LocalProvider;
  status: HealthStatus;
  circuit: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt?: string;
  lastHealthyAt?: string;
  lastError?: string;
}

export interface HealthChangeEvent {
  provider: LocalProvider;
  previous: ProviderHealthState;
  current: ProviderHealthState;
}

interface MonitorOpts {
  config: HealthCheckConfig;
  onChange?: (event: HealthChangeEvent) => void;
  onState?: (state: ProviderHealthState) => void;
}

const DEFAULT_STATE: Omit<ProviderHealthState, "provider"> = {
  status: "unknown",
  circuit: "closed",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
};

const PROVIDERS: LocalProvider[] = ["ollama", "sglang", "vllm"];

export class ModelHealthMonitor {
  private readonly config: HealthCheckConfig;
  private readonly onChange?: (event: HealthChangeEvent) => void;
  private readonly onState?: (state: ProviderHealthState) => void;
  private readonly states = new Map<LocalProvider, ProviderHealthState>();
  private readonly trackedProviders = new Set<LocalProvider>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(opts: MonitorOpts) {
    this.config = opts.config;
    this.onChange = opts.onChange;
    this.onState = opts.onState;
    for (const provider of PROVIDERS) {
      this.states.set(provider, { ...DEFAULT_STATE, provider });
    }
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.config.intervalSeconds * 1000);
    this.timer.unref?.();
    if (this.trackedProviders.size > 0) {
      void this.poll();
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  trackModel(modelRef: string): void {
    const provider = parseLocalProvider(modelRef);
    if (!provider) return;
    const before = this.trackedProviders.size;
    this.trackedProviders.add(provider);
    if (this.timer && before === 0) {
      void this.poll();
    }
  }

  getStateForModel(modelRef: string): ProviderHealthState | null {
    const provider = parseLocalProvider(modelRef);
    if (!provider) return null;
    return this.getState(provider);
  }

  getState(provider: LocalProvider): ProviderHealthState {
    const state = this.states.get(provider) ?? { ...DEFAULT_STATE, provider };
    return applyStaleness(state, this.config.staleAfterSeconds);
  }

  getPolicy(): FailoverPolicy {
    return this.config.failoverPolicy;
  }

  private async poll(): Promise<void> {
    if (this.inFlight) return;
    if (this.trackedProviders.size === 0) return;
    this.inFlight = true;

    try {
      const providers = [...this.trackedProviders];
      await Promise.all(providers.map(async (provider) => {
        await this.checkProvider(provider);
      }));
    } finally {
      this.inFlight = false;
    }
  }

  private async checkProvider(provider: LocalProvider): Promise<void> {
    const previous = this.states.get(provider) ?? { ...DEFAULT_STATE, provider };
    const now = new Date().toISOString();
    const next = { ...previous };
    next.lastCheckedAt = now;

    try {
      const ok = await probeProvider(provider, this.config.timeoutSeconds);
      if (ok) {
        next.consecutiveFailures = 0;
        next.consecutiveSuccesses = previous.consecutiveSuccesses + 1;
        next.lastHealthyAt = now;
        next.lastError = undefined;
        if (previous.circuit === "open") {
          next.circuit = next.consecutiveSuccesses >= this.config.recoveryThreshold
            ? "closed"
            : "half_open";
        } else {
          next.circuit = "closed";
        }
        next.status = next.circuit === "half_open" ? "degraded" : "healthy";
      } else {
        next.consecutiveSuccesses = 0;
        next.consecutiveFailures = previous.consecutiveFailures + 1;
        next.lastError = "health probe failed";
        if (next.consecutiveFailures >= this.config.failureThreshold) {
          next.circuit = "open";
          next.status = "down";
        } else {
          next.circuit = "closed";
          next.status = "degraded";
        }
      }
    } catch (err) {
      next.consecutiveSuccesses = 0;
      next.consecutiveFailures = previous.consecutiveFailures + 1;
      next.lastError = err instanceof Error ? err.message : String(err);
      if (next.consecutiveFailures >= this.config.failureThreshold) {
        next.circuit = "open";
        next.status = "down";
      } else {
        next.circuit = "closed";
        next.status = "degraded";
      }
    }

    this.states.set(provider, next);
    this.onState?.(next);
    if (
      this.onChange &&
      (previous.status !== next.status || previous.circuit !== next.circuit)
    ) {
      this.onChange({ provider, previous, current: next });
    }
  }
}

export function parseLocalProvider(modelRef: string): LocalProvider | null {
  if (!isLocalModel(modelRef)) return null;
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) return null;
  const provider = modelRef.slice(0, slashIdx);
  if (provider === "ollama" || provider === "sglang" || provider === "vllm") {
    return provider;
  }
  return null;
}

function applyStaleness(
  state: ProviderHealthState,
  staleAfterSeconds: number,
): ProviderHealthState {
  if (!state.lastCheckedAt) return state;
  const ageMs = Date.now() - Date.parse(state.lastCheckedAt);
  if (Number.isNaN(ageMs)) return state;
  if (ageMs <= staleAfterSeconds * 1000) return state;
  return {
    ...state,
    status: "unknown",
    circuit: "open",
    lastError: "health status stale",
  };
}

async function probeProvider(
  provider: LocalProvider,
  timeoutSeconds: number,
): Promise<boolean> {
  const timeout = timeoutSeconds * 1000;
  const host = providerHost(provider);

  if (provider === "ollama") {
    return probe(`${host}/api/tags`, timeout);
  }

  if (provider === "sglang") {
    const healthOk = await probe(`${host}/health`, timeout);
    if (healthOk) return true;
    return probe(`${host}/v1/models`, timeout);
  }

  // vllm
  const healthOk = await probe(`${host}/health`, timeout);
  if (healthOk) return true;
  return probe(`${host}/v1/models`, timeout);
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { method: "GET", signal });
  return res.ok;
}

function providerHost(provider: LocalProvider): string {
  if (provider === "ollama") {
    return sanitizeHost(process.env.OLLAMA_HOST ?? "http://ollama:11434");
  }
  if (provider === "sglang") {
    return sanitizeHost(process.env.SGLANG_HOST ?? "http://sglang:30000");
  }
  return sanitizeHost(process.env.VLLM_HOST ?? "http://vllm:8000");
}

function sanitizeHost(host: string): string {
  return host.endsWith("/") ? host.slice(0, -1) : host;
}
