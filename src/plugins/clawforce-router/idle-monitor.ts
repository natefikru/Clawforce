export interface IdleEvent {
  agentId: string;
  lastActivityAt: string;
  idleMinutes: number;
}

export interface IdleMonitorOptions {
  thresholdMinutes: number;
  cooldownMinutes: number;
  checkIntervalMs?: number;
  onIdle: (event: IdleEvent) => void;
}

export class IdleMonitor {
  private readonly thresholdMs: number;
  private readonly cooldownMs: number;
  private readonly checkIntervalMs: number;
  private readonly onIdle: (event: IdleEvent) => void;
  private readonly lastActivity = new Map<string, number>();
  private readonly lastAlertAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: IdleMonitorOptions) {
    this.thresholdMs = opts.thresholdMinutes * 60_000;
    this.cooldownMs = opts.cooldownMinutes * 60_000;
    this.checkIntervalMs = opts.checkIntervalMs ?? 60_000;
    this.onIdle = opts.onIdle;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(Date.now()), this.checkIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  recordActivity(agentId: string, atMs: number = Date.now()): void {
    this.lastActivity.set(agentId, atMs);
  }

  check(nowMs: number): void {
    for (const [agentId, lastActivityAt] of this.lastActivity.entries()) {
      const idleMs = nowMs - lastActivityAt;
      if (idleMs < this.thresholdMs) {
        continue;
      }
      const lastAlert = this.lastAlertAt.get(agentId) ?? 0;
      if (nowMs - lastAlert < this.cooldownMs) {
        continue;
      }
      this.lastAlertAt.set(agentId, nowMs);
      this.onIdle({
        agentId,
        lastActivityAt: new Date(lastActivityAt).toISOString(),
        idleMinutes: Math.floor(idleMs / 60_000),
      });
    }
  }
}
