# Clawforce: Beyond MVP — Feature Depth Expansion Plan

**Date**: 2026-02-15
**Status**: Phase 0+1 complete (285 tests, 14 commits)
**Goal**: Elevate each feature from demo-ready to investor-impressive

---

## Current State (What We Have)

| Feature | MVP Status | Limitation |
|---------|-----------|------------|
| Model Router | Regex PII + heuristic complexity → model recommendation | Advisory only (can't enforce), no learning, no cost-awareness |
| Compliance Logger | Structured JSONL via 3 hooks | No rotation, no retention, silent error swallowing |
| Dashboard | 4-panel polling (status, activity, cost, tasks) | No auth, no filtering, no real-time, simplistic savings calc |
| Deploy | Single-command Docker Compose | No GPU, no pre-flight, no rollback, single agent only |
| Roles | 3 SKILL.md templates | Prompt-based approval (not enforced), no feedback loop |

---

## 1. Model Router — Deep Expansion

The router is our proprietary IP and biggest differentiator. The current implementation is a proof-of-concept. Here's how to make it production-grade.

### 1.1 Enforce Model Selection (Not Just Advise)

**Problem**: Current plugin returns `{prependContext}` — it can suggest a model but can't enforce it.

**Solution**: OpenClaw's config system supports per-agent model overrides. Instead of one agent, deploy multiple agents with different model configs and route messages to the right agent.

```yaml
# Generated openclaw.json (multi-agent approach)
agents:
  - id: "local-agent"
    model:
      primary: "ollama/llama3.3:8b"
    workspace: "./workspace"
  - id: "cloud-agent"
    model:
      primary: "anthropic/claude-sonnet-4-5"
      fallbacks: ["anthropic/claude-haiku-4-5"]
    workspace: "./workspace"
```

The router plugin intercepts the message at the gateway level and routes to the correct agent ID based on PII/complexity analysis. OpenClaw's binding system already supports this:

```typescript
bindings: [
  { agentId: "local-agent",  match: { channel: "slack", roles: ["pii-flagged"] } },
  { agentId: "cloud-agent",  match: { channel: "slack" } },
]
```

**Implementation**: Add a gateway-level middleware (or use OpenClaw's routing bindings dynamically) that assigns incoming messages to the correct agent before the agent even starts.

### 1.2 Multi-Dimensional Routing

Current routing considers 2 dimensions (PII + complexity). Expand to 5:

| Dimension | Signal | Routing Effect |
|-----------|--------|---------------|
| **Data Sensitivity** | PII regex, keyword blocklist, document classification | PII → local model always |
| **Task Complexity** | Word count, code blocks, multi-step markers, domain keywords | Complex → capable model |
| **Cost Budget** | Per-user/per-team daily budget, token accumulator | Over budget → cheapest available model |
| **Latency Requirement** | Message channel (DM = low latency, cron = tolerant), explicit priority | Urgent → fastest model (even if expensive) |
| **Task Domain** | Code generation, writing, analysis, conversation, data extraction | Domain-specialized models (code → deepseek, writing → claude) |

```yaml
# clawforce.yaml — expanded router config
router:
  enabled: true
  dimensions:
    sensitivity:
      pii_patterns: ["ssn", "credit_card", "email", "phone"]
      keywords: ["password", "secret", "confidential", "salary"]
      document_types: ["contract", "medical", "financial"]
    complexity:
      thresholds:
        low: 2
        high: 5
      custom_keywords: ["refactor", "architect", "migrate"]
    cost:
      daily_budget: 10.00          # USD per day
      per_request_cap: 0.50        # Max cost per single request
      fallback_when_exceeded: "ollama/llama3.3:8b"
    latency:
      urgent_channels: ["slack-dm", "telegram-dm"]
      preferred_fast_model: "anthropic/claude-haiku-4-5"
    domain:
      code: "deepseek/deepseek-coder-v2"
      writing: "anthropic/claude-sonnet-4-5"
      analysis: "anthropic/claude-opus-4-6"
      conversation: "ollama/llama3.3:8b"

  # Priority order when dimensions conflict
  priority: ["sensitivity", "cost", "domain", "complexity", "latency"]

  models:
    - id: "ollama/llama3.3:8b"
      capabilities: ["conversation", "simple-tasks"]
      cost_per_1k: 0
      latency_ms: 200
      local: true
    - id: "anthropic/claude-haiku-4-5"
      capabilities: ["fast-response", "simple-analysis"]
      cost_per_1k: 0.00025
      latency_ms: 500
    - id: "anthropic/claude-sonnet-4-5"
      capabilities: ["code", "writing", "analysis", "complex-tasks"]
      cost_per_1k: 0.003
      latency_ms: 1500
    - id: "anthropic/claude-opus-4-6"
      capabilities: ["deep-analysis", "complex-reasoning", "long-context"]
      cost_per_1k: 0.015
      latency_ms: 3000
```

### 1.3 Domain Detection

Classify prompts by domain to route to specialized models:

```typescript
// src/plugins/clawforce-router/domain-detector.ts
export type Domain = "code" | "writing" | "analysis" | "conversation" | "data" | "unknown";

const DOMAIN_SIGNALS: Record<Domain, { patterns: RegExp[]; keywords: string[] }> = {
  code: {
    patterns: [/```\w+/, /function\s+\w+/, /class\s+\w+/, /import\s+{/, /def\s+\w+/],
    keywords: ["refactor", "debug", "implement", "compile", "deploy", "test", "bug", "PR", "commit"],
  },
  writing: {
    patterns: [/draft\s+(a|an|the)\s/, /write\s+(a|an|the)\s/, /compose\s/],
    keywords: ["email", "report", "summary", "blog", "proposal", "memo", "announcement"],
  },
  analysis: {
    patterns: [/compare\s.*\bvs\b/, /analyze\s/, /evaluate\s/],
    keywords: ["analyze", "compare", "evaluate", "research", "investigate", "assess", "benchmark"],
  },
  data: {
    patterns: [/SELECT\s/i, /INSERT\s/i, /\.csv\b/, /\.json\b/, /spreadsheet/],
    keywords: ["database", "query", "extract", "transform", "aggregate", "filter", "export"],
  },
  conversation: {
    patterns: [/^(hi|hello|hey|thanks|ok|sure)\b/i, /\?$/],
    keywords: [],
  },
};

export function detectDomain(text: string): { domain: Domain; confidence: number } {
  // Score each domain, return highest with confidence
}
```

### 1.4 Cost-Aware Routing with Budget Tracking

Track spend in real-time and adjust routing when approaching budget:

```typescript
// src/plugins/clawforce-router/budget-tracker.ts
interface BudgetState {
  dailySpend: number;
  dailyBudget: number;
  requestCount: number;
  lastReset: string; // ISO date
}

export class BudgetTracker {
  private state: BudgetState;
  private statePath: string;

  isOverBudget(): boolean {
    return this.state.dailySpend >= this.state.dailyBudget;
  }

  isApproachingBudget(threshold = 0.8): boolean {
    return this.state.dailySpend >= this.state.dailyBudget * threshold;
  }

  recordSpend(tokens: { input: number; output: number }, model: string): void {
    const cost = calculateTokenCost(tokens, model);
    this.state.dailySpend += cost;
    this.state.requestCount++;
    this.persist();
  }

  getRecommendation(): "normal" | "conservative" | "local-only" {
    if (this.isOverBudget()) return "local-only";
    if (this.isApproachingBudget()) return "conservative";
    return "normal";
  }
}
```

### 1.5 Routing Feedback Loop (Self-Improving)

Track whether routing decisions led to good outcomes and adjust weights:

```typescript
// src/plugins/clawforce-router/feedback.ts
interface RoutingOutcome {
  routingDecision: RoutingDecision;
  actualModel: string;
  success: boolean;           // Did the task complete successfully?
  userSatisfaction?: number;  // 1-5 rating if available
  tokenEfficiency: number;    // output_tokens / input_tokens
  latencyMs: number;
  retryCount: number;
}

// After N outcomes, adjust complexity thresholds
export function recalibrateThresholds(outcomes: RoutingOutcome[]): ComplexityThresholds {
  // If low-complexity tasks routed to local model frequently fail/retry,
  // raise the threshold so more tasks go to capable models
  // If high-complexity tasks routed to cloud succeed easily,
  // lower the threshold to save costs
}
```

### 1.6 Model Performance Benchmarking

Run periodic benchmarks to measure actual model capabilities for your specific use cases:

```typescript
// src/plugins/clawforce-router/benchmark.ts
interface BenchmarkResult {
  model: string;
  domain: Domain;
  accuracy: number;       // 0-1 based on expected output matching
  latencyMs: number;
  costPerRequest: number;
  throughput: number;      // requests/minute
}

// Run during off-hours (cron job)
export async function runBenchmarks(models: string[], testCases: TestCase[]): Promise<BenchmarkResult[]> {
  // For each model × domain, run test cases and measure
  // Store results → feed back into routing rules
}
```

### 1.7 Routing Decision Explainability

For the dashboard and audit trail, make routing decisions fully transparent:

```typescript
interface ExplainedRoutingDecision extends RoutingDecision {
  explanation: {
    dimensionScores: Record<string, { score: number; weight: number; signal: string }>;
    candidateModels: Array<{ model: string; totalScore: number; disqualifiedReason?: string }>;
    budgetStatus: "normal" | "conservative" | "local-only";
    overrideReason?: string;  // e.g., "PII detected — forced to local"
  };
}
```

Dashboard can then render a routing decision breakdown showing exactly why each model was chosen.

---

## 2. Compliance Logger — Production Grade

### 2.1 Log Rotation and Retention

```typescript
// src/plugins/clawforce-compliance/rotation.ts
interface RotationConfig {
  maxFileSize: string;     // "100MB"
  maxFiles: number;        // 30 (keep 30 days)
  compress: boolean;       // gzip old files
  retentionDays: number;   // Auto-delete after N days
}

// compliance.jsonl → compliance-2026-02-15.jsonl → compliance-2026-02-14.jsonl.gz
```

### 2.2 Structured Event Schema (Versioned)

Move from ad-hoc JSONL to a versioned schema:

```typescript
interface ComplianceEvent {
  version: "1.0";
  ts: string;
  eventId: string;          // UUID for deduplication
  sessionId: string;
  agentId: string;
  event: ComplianceEventType;
  // Event-specific payload
  payload: ToolCallPayload | MessagePayload | RoutingPayload | ErrorPayload;
  // Metadata
  meta: {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    durationMs?: number;
    channel?: string;
  };
}
```

### 2.3 Alert Rules Engine

Detect anomalies and trigger alerts:

```yaml
# clawforce.yaml
compliance:
  enabled: true
  alerts:
    - name: "High error rate"
      condition: "error_rate > 0.1 over 5m"
      severity: "critical"
      notify: ["slack:#ops-alerts"]
    - name: "Cost spike"
      condition: "hourly_cost > daily_budget / 8"
      severity: "warning"
      notify: ["slack:#cost-alerts"]
    - name: "PII in cloud model"
      condition: "event.routing_decision.hasPII && !event.routing_decision.model.startsWith('ollama')"
      severity: "critical"
      notify: ["slack:#security"]
```

### 2.4 Compliance Report Generation

Auto-generate reports for compliance reviews:

```typescript
// clawforce audit --report weekly --format pdf
interface ComplianceReport {
  period: { start: string; end: string };
  summary: {
    totalEvents: number;
    piiDetections: number;
    localRoutingPercentage: number;
    errorRate: number;
    costTotal: number;
  };
  piiIncidents: PIIIncident[];       // Every PII detection with context
  modelUsageBreakdown: ModelUsage[]; // Per-model token/cost
  alertsTriggered: Alert[];
  recommendations: string[];
}
```

---

## 3. Dashboard — Investor-Grade

### 3.1 Real-Time via WebSocket/SSE

Replace polling with Server-Sent Events:

```typescript
// clawforce-dashboard/src/app/api/stream/route.ts
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      // Watch compliance.jsonl for new lines (fs.watch)
      // Push new events to client as they arrive
      const watcher = fs.watch(COMPLIANCE_LOG, () => {
        const newEntries = readNewLines();
        controller.enqueue(`data: ${JSON.stringify(newEntries)}\n\n`);
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

### 3.2 Interactive Cost Explorer

The cost tracker is our investor showpiece. Make it interactive:

**Cost Timeline Chart**:
- X-axis: time (hourly/daily/weekly)
- Y-axis: cost (USD)
- Stacked bars: cloud (blue) vs local (green)
- Trend line showing savings growth over time

**Model Comparison Table**:
| Model | Requests | Tokens | Cost | Avg Latency | Success Rate |
|-------|----------|--------|------|-------------|-------------|
| ollama/llama3.3:8b | 847 | 1.2M | $0.00 | 180ms | 94% |
| claude-sonnet-4-5 | 312 | 2.8M | $8.40 | 1.4s | 99% |
| **Total** | **1,159** | **4.0M** | **$8.40** | | |
| **Without routing** | 1,159 | 4.0M | **$24.70** | | |
| **Savings** | | | **$16.30 (66%)** | | |

**"What If" Calculator**:
- Slider: "What if we routed X% to local?"
- Shows projected monthly cost at different routing percentages
- Shows projected savings vs current approach

### 3.3 Routing Decision Visualizer

Show every routing decision with full reasoning:

```
┌──────────────────────────────────────────────────┐
│ Routing Decision #1247                     2:34pm│
├──────────────────────────────────────────────────┤
│ Input: "my ssn is 123-45-6789, check records"   │
│                                                   │
│ Dimensions:                                       │
│   Sensitivity: ████████████ PII DETECTED (SSN)   │
│   Complexity:  ███░░░░░░░░░ Low (score: 1)       │
│   Domain:      conversation                       │
│   Budget:      ██████░░░░░░ 52% used ($5.20/$10) │
│                                                   │
│ Decision: ollama/llama3.3:8b                     │
│ Reason: PII detected — routed to local model     │
│ Override: sensitivity > complexity                │
└──────────────────────────────────────────────────┘
```

### 3.4 Agent Health Monitoring

Beyond container status — show agent behavioral health:

- **Response rate**: % of messages that got a response
- **Error rate**: Tool failures, model errors
- **Avg response time**: How long the agent takes to reply
- **Session health**: Active sessions, memory usage
- **Model availability**: Provider status, rate limit proximity
- **Cron job status**: Last run, next run, success/failure history

### 3.5 Authentication

Add basic auth for demo security:

```yaml
dashboard:
  enabled: true
  port: 3000
  auth:
    enabled: true
    method: "basic"        # or "token" or "oauth"
    username: "admin"
    password: "${DASHBOARD_PASSWORD}"
```

### 3.6 Exportable Reports (PDF/CSV)

For investor meetings — one-click export:

- **Executive Summary PDF**: Cost savings, routing stats, compliance summary
- **Detailed CSV**: Full event log export for analysis
- **API endpoint**: `/api/export?format=pdf&period=7d`

---

## 4. Multi-Agent Deployment

### 4.1 Multiple Agents Per Deployment

OpenClaw supports multiple agents with routing. Expose this in Clawforce:

```yaml
# clawforce.yaml — multi-agent config
name: "acme-corp"

agents:
  - id: "inbox-analyst"
    role: "inbox-analyst"
    channels:
      - type: "slack"
        channel: "C0123456789"    # #general
    model: "anthropic/claude-sonnet-4-5"

  - id: "research-bot"
    role: "research-agent"
    channels:
      - type: "slack"
        channel: "C9876543210"    # #research
    model: "anthropic/claude-opus-4-6"

  - id: "process-worker"
    role: "process-automator"
    trigger: "cron"
    schedule: "0 8 * * 1-5"
    model: "ollama/llama3.3:8b"
```

### 4.2 Agent Collaboration

Agents can delegate work to each other:

```yaml
agents:
  - id: "inbox-analyst"
    can_delegate_to: ["research-bot"]
    # When inbox-analyst detects a research request,
    # it delegates to research-bot and monitors completion

  - id: "research-bot"
    reports_to: ["inbox-analyst"]
    # Research-bot sends completed reports back to inbox-analyst
    # for delivery to the requesting channel
```

### 4.3 Team-Based Routing

Route different teams to different agents:

```yaml
routing:
  rules:
    - match:
        slack_channel: "C001"  # #engineering
      agent: "code-helper"
    - match:
        slack_channel: "C002"  # #marketing
      agent: "content-writer"
    - match:
        telegram_user: "123456"
      agent: "exec-assistant"
```

---

## 5. Enhanced Approval Workflow

### 5.1 Code-Enforced Approvals (Not Just Prompt-Based)

Use OpenClaw's hook system to intercept tool calls:

```typescript
// src/plugins/clawforce-approval/index.ts
export function activate(api: ApprovalPluginApi) {
  api.registerHook("before_tool_call", async (event) => {
    const { tool, params } = event;

    if (requiresApproval(tool, params)) {
      const approval = await requestApproval({
        tool,
        params,
        channel: api.config.approvalChannel,
        timeout: 300_000, // 5 minutes
      });

      if (!approval.approved) {
        return { abort: true, reason: `Rejected by ${approval.reviewer}` };
      }
    }

    return { proceed: true };
  });
}

function requiresApproval(tool: string, params: unknown): boolean {
  const requireApprovalTools = [
    "exec",              // Shell commands
    "browser.navigate",  // External site visits
    "slack.send",        // Outbound messages
    "write",             // File modifications
  ];
  return requireApprovalTools.includes(tool);
}
```

### 5.2 Approval Dashboard Panel

Add a 5th panel to the dashboard showing pending and completed approvals:

- Pending approvals with one-click approve/reject buttons
- Approval history with reviewer, timestamp, decision
- Auto-escalation: if no response in N minutes, escalate to backup reviewer
- Approval analytics: avg response time, approval rate, most-approved actions

---

## 6. Advanced PII Detection

### 6.1 Context-Aware Detection

The current regex approach has false positives. Add context awareness:

```typescript
// src/plugins/clawforce-router/pii-detector-v2.ts

interface PIIDetection {
  type: string;
  value: string;
  confidence: number;      // 0-1
  context: string;         // Surrounding text
  isLikelyFalsePositive: boolean;
}

// After regex match, validate with context
function validateMatch(match: RegExpMatch, text: string): PIIDetection {
  const context = text.slice(
    Math.max(0, match.index - 50),
    Math.min(text.length, match.index + match[0].length + 50),
  );

  // Check for false positive indicators
  const falsePositiveIndicators = [
    /example/i, /test/i, /dummy/i, /sample/i, /fake/i,
    /placeholder/i, /xxx/i, /000-00-0000/,
  ];

  const isLikelyFP = falsePositiveIndicators.some((p) => p.test(context));

  return {
    type: match.patternName,
    value: match[0],
    confidence: isLikelyFP ? 0.3 : 0.9,
    context,
    isLikelyFalsePositive: isLikelyFP,
  };
}
```

### 6.2 Document Classification

Detect sensitive document types, not just individual PII patterns:

```typescript
const DOCUMENT_CLASSIFIERS: Record<string, { keywords: string[]; threshold: number }> = {
  financial: {
    keywords: ["revenue", "profit", "loss", "balance sheet", "P&L", "EBITDA", "cash flow", "quarterly"],
    threshold: 3, // Need 3+ keywords to classify
  },
  medical: {
    keywords: ["diagnosis", "treatment", "prescription", "patient", "HIPAA", "PHI", "medical record"],
    threshold: 2,
  },
  legal: {
    keywords: ["contract", "clause", "liability", "indemnify", "confidential", "NDA", "settlement"],
    threshold: 3,
  },
  hr: {
    keywords: ["salary", "compensation", "performance review", "termination", "benefits", "PTO"],
    threshold: 2,
  },
};
```

### 6.3 Configurable Sensitivity Tiers

Not all PII is equal. Allow tiered response:

```yaml
router:
  sensitivity:
    tiers:
      critical:        # SSN, credit cards → always local, never log content
        patterns: ["ssn", "credit_card"]
        action: "local_only"
        log_content: false
      high:            # Email, phone → prefer local, redact in logs
        patterns: ["email", "phone"]
        action: "prefer_local"
        log_content: "redacted"
      medium:          # Keywords → log warning, route normally
        keywords: ["salary", "performance"]
        action: "warn"
        log_content: true
```

---

## 7. GPU and Performance

### 7.1 GPU Passthrough for Ollama

```typescript
// src/config/generate-compose.ts — enhanced ollama service
if (config.ollama?.enabled) {
  compose.services.ollama = {
    image: "ollama/ollama:latest",
    container_name: `${containerPrefix}-ollama`,
    restart: "unless-stopped",
    deploy: {
      resources: {
        reservations: {
          devices: [{
            driver: "nvidia",
            count: config.ollama.gpuCount ?? 1,
            capabilities: ["gpu"],
          }],
        },
      },
    },
    // ...
  };
}
```

```yaml
# clawforce.yaml
ollama:
  enabled: true
  model: "llama3.3:8b"
  gpu:
    enabled: true
    count: 1
    driver: "nvidia"   # or "amd"
```

### 7.2 Model Preloading

Pre-pull and warm up models during deploy:

```typescript
// During deploy, after ollama starts:
// 1. Pull the model
await exec("docker", ["exec", ollamaContainer, "ollama", "pull", model]);
// 2. Warm up with a test prompt (loads into GPU memory)
await exec("docker", ["exec", ollamaContainer, "ollama", "run", model, "hello"]);
```

---

## 8. Deployment Enhancements

### 8.1 Pre-Flight Checks

```typescript
async function preflight(config: ClawforceConfig): Promise<PreflightResult[]> {
  const checks: PreflightResult[] = [];

  // Docker available?
  checks.push(await checkDocker());

  // OpenClaw image exists?
  checks.push(await checkImage("openclaw:local"));

  // API keys valid?
  if (config.models.api_key) {
    checks.push(await checkAnthropicKey(config.models.api_key));
  }

  // Slack tokens valid?
  if (config.slack) {
    checks.push(await checkSlackTokens(config.slack));
  }

  // Port available?
  checks.push(await checkPort(18789));
  if (config.dashboard?.enabled) {
    checks.push(await checkPort(config.dashboard.port ?? 3000));
  }

  // GPU available for Ollama?
  if (config.ollama?.gpu?.enabled) {
    checks.push(await checkGPU());
  }

  return checks;
}
```

### 8.2 Rolling Updates

```bash
clawforce update --config clawforce.yaml
# 1. Parse new config
# 2. Diff against running config
# 3. Regenerate changed files only
# 4. Rolling restart: dashboard first, then gateway
# 5. Health check
# 6. Rollback if health check fails
```

### 8.3 Backup and Restore

```bash
clawforce backup                    # Tar config + data + workspace
clawforce restore backup-2026-02.tar.gz  # Restore from backup
```

---

## 9. New CLI Commands

```bash
# Model management
clawforce models list               # Show available models + status
clawforce models benchmark          # Run performance benchmarks
clawforce models cost-report        # Show cost breakdown

# Routing
clawforce route test "my SSN is 123-45-6789"  # Test routing decision
clawforce route stats                          # Show routing statistics
clawforce route tune                           # Recalibrate from feedback

# Compliance
clawforce audit --source compliance --format json   # JSON output
clawforce audit --report weekly --output report.pdf  # Generate report
clawforce audit --alerts                             # Show triggered alerts

# Multi-agent
clawforce agents list               # Show all agents + status
clawforce agents logs research-bot  # Tail specific agent logs

# Health
clawforce doctor                    # Run pre-flight checks
clawforce benchmark                 # Run full system benchmark
```

---

## 10. Implementation Priority

### Tier 1 — High Impact, Moderate Effort (Do Next)

| Feature | Why | Effort |
|---------|-----|--------|
| Multi-dimensional routing (cost + domain) | Core differentiator, impressive for demos | 2-3 days |
| Budget tracking with daily limits | Practical enterprise need, easy to demo | 1-2 days |
| GPU passthrough for Ollama | 10x local model performance | 1 day |
| Dashboard WebSocket/SSE | Real-time feels more impressive than polling | 1-2 days |
| Interactive cost explorer chart | Investor showpiece | 2-3 days |
| `clawforce route test` CLI command | Quick demo tool | 0.5 day |

### Tier 2 — High Impact, Higher Effort

| Feature | Why | Effort |
|---------|-----|--------|
| Multi-agent deployment | Unlocks team-based routing, collaboration | 3-5 days |
| Code-enforced approval workflow | Moves from "trust the prompt" to "enforced policy" | 2-3 days |
| Routing feedback loop | Self-improving system, strong narrative | 3-4 days |
| Compliance alert rules | Enterprise requirement, shows maturity | 2-3 days |
| Pre-flight checks (`clawforce doctor`) | Reduces support burden, polished UX | 1-2 days |

### Tier 3 — Nice to Have

| Feature | Why | Effort |
|---------|-----|--------|
| Context-aware PII detection | Reduces false positives | 2 days |
| Document classification | Handles sensitive docs, not just individual PII | 2 days |
| Sensitivity tiers (critical/high/medium) | Nuanced policy | 1-2 days |
| Model benchmarking | Data-driven routing | 3-4 days |
| Dashboard auth | Security for non-localhost deployments | 1 day |
| Log rotation + retention | Production operations | 1 day |
| Exportable PDF reports | Investor meetings | 2-3 days |
| Rolling updates | Zero-downtime config changes | 2-3 days |

---

## 11. Demo Script (Expanded — 10 minutes)

1. **Deploy** (1 min): `clawforce deploy -c demo.yaml` → 3 containers (gateway + ollama + dashboard)
2. **Dashboard** (1 min): Open `localhost:3000` — show real-time activity stream
3. **Simple question** (30s): "What's the weather?" → Routed to local model (free)
4. **PII message** (30s): "Check records for SSN 123-45-6789" → Routed to local (PII detected)
5. **Complex task** (1 min): "Analyze our Q4 financials and compare to competitors" → Routed to Claude Opus (high complexity + analysis domain)
6. **Budget demo** (1 min): Show budget tracker approaching limit → next request auto-routes to cheaper model
7. **Routing explainer** (1 min): Click a routing decision in dashboard → show full dimension breakdown
8. **Cost savings** (1 min): Show cost explorer — "66% of requests were free, saving $16/day"
9. **Compliance** (30s): `clawforce audit --source compliance` → show structured log
10. **"What if" calculator** (30s): Slide routing percentage → show projected savings at scale

**Key talking point**: "Every routing decision is explainable, every action is logged, and all sensitive data stayed on this machine."

---

## 12. OpenClaw Capabilities Gap — What We're Not Exposing

**This is the biggest gap in Clawforce today.** OpenClaw has 28 tools, 4 tool profiles, sandboxing, browser automation, vector memory, skills system, and deep agent configuration. Clawforce currently configures about 10% of this — just channels, model selection, and plugins. Everything else is left at defaults or inaccessible.

### 12.1 The Full OpenClaw Tool Inventory

| Tool | What It Does | Clawforce Exposes? |
|------|-------------|-------------------|
| `read` | Read files with MIME detection, image support | No (default) |
| `write` | Write files to workspace | No (default) |
| `edit` | Edit files via oldText/newText replacement | No (default) |
| `apply_patch` | Apply patches (OpenAI models) | No (default) |
| `exec` | Shell command execution (host/sandbox/gateway/node) | No (default) |
| `process` | Manage running exec sessions (list, poll, kill) | No (default) |
| `browser` | Full Playwright browser automation (navigate, click, screenshot, PDF) | No (default) |
| `canvas` | Node canvas control for UI rendering | No (default) |
| `web_search` | Web search via Brave/Perplexity/Grok | No (default) |
| `web_fetch` | Fetch web content with Readability/Firecrawl | No (default) |
| `memory_search` | Semantic vector search over MEMORY.md + sessions | No (default) |
| `memory_get` | Read snippets from memory files | No (default) |
| `sessions_list` | List agent sessions | No (default) |
| `sessions_history` | Read session transcript history | No (default) |
| `sessions_send` | Agent-to-agent messaging | No (default) |
| `sessions_spawn` | Spawn sub-agent runs in isolated sessions | No (default) |
| `session_status` | Get session status/metadata | No (default) |
| `agents_list` | List available agent IDs | No (default) |
| `image` | Image understanding (Anthropic/OpenAI/Google vision) | No (default) |
| `tts` | Text-to-speech with voice output | No (default) |
| `message` | Universal messaging (send/reply/react/thread/broadcast) | No (default) |
| `cron` | Cron job management (add/update/remove/run/status) | Partial (role partials) |
| `gateway` | Gateway control (restart, config, update) | No (default) |
| `nodes` | Remote device control (camera, screen, location, notify) | No (default) |
| Discord actions | Guild admin, moderation, presence | No |
| Slack actions | Pins, reactions, search, threading | No |
| Telegram actions | Stickers, inline buttons, reactions | No |
| WhatsApp actions | Reactions | No |

### 12.2 OpenClaw Config Systems We Don't Configure

| System | What It Controls | Impact of Not Configuring |
|--------|-----------------|--------------------------|
| **`tools.profile`** | Which tools agents can use (minimal/coding/messaging/full) | Agents get default profile — may be too restricted or too permissive |
| **`tools.exec`** | Shell execution security (deny/allowlist/full), timeout, PATH | No control over what commands agents can run |
| **`tools.web`** | Web search provider (Brave/Perplexity/Grok), API keys, caching | Web search may not work without provider config |
| **`browser`** | Browser enablement, headless mode, CDP URL, profiles | Browser automation won't work unless user manually configures |
| **`sandbox`** | Docker sandboxing (mode, workspace access, resource limits, network) | No isolation for agent code execution |
| **`skills`** | Skill loading, allowlists, per-skill config | Only SKILL.md templates — no bundled skills, no custom skills |
| **`memory`** | Vector search, embeddings, session indexing | Agents have no long-term memory across sessions |
| **`agents.defaults`** | Thinking level, timeout, heartbeat, sub-agents, typing indicators | All at defaults — no tuning for enterprise use cases |
| **`auth`** | Authentication profiles for multi-provider API keys | Single API key only |
| **`models`** | Model catalog with aliases, per-model thinking config | No model aliases or advanced model config |

### 12.3 Approach: Capability Profiles + Dashboard Configuration

The right approach isn't to expose every OpenClaw knob in `clawforce.yaml` (that defeats the "deploy in 5 minutes" UX). Instead:

**Layer 1 — Capability Profiles (clawforce.yaml)**

Opinionated presets that bundle related OpenClaw settings:

```yaml
# clawforce.yaml
capabilities:
  # Preset profiles (simple)
  profile: "full"   # minimal | standard | full

  # Or explicit overrides
  browser:
    enabled: true
    headless: true
  exec:
    enabled: true
    security: "allowlist"
    allowed_commands: ["git", "npm", "python", "curl"]
  web_search:
    enabled: true
    provider: "brave"
    api_key: "${BRAVE_API_KEY}"
  memory:
    enabled: true
    provider: "local"        # local embeddings, no external API needed
  sandbox:
    enabled: true
    mode: "non-main"         # Sandbox sub-agent sessions
    resource_limits:
      memory: "512m"
      cpus: 1
  skills:
    load_bundled: true
    custom_dirs: ["./skills"]
```

What each profile maps to:

| Profile | Tools | Sandbox | Browser | Web | Memory | Exec Security |
|---------|-------|---------|---------|-----|--------|--------------|
| `minimal` | read, write, message, session_status | off | off | off | off | deny |
| `standard` | coding + messaging + web | non-main | headless | brave | local | allowlist |
| `full` | all tools | all sessions | full | brave + firecrawl | local + sessions | full |

**Layer 2 — Dashboard Configuration Panel**

A settings page in the dashboard that lets you toggle capabilities without redeploying:

```
┌─────────────────────────────────────────────────┐
│ Agent Capabilities                    [Save]     │
├─────────────────────────────────────────────────┤
│                                                   │
│ Tool Access                                       │
│ ┌─────────────────────────────────────────────┐  │
│ │ Profile: [Standard ▼]                       │  │
│ │                                             │  │
│ │ ☑ File Operations (read, write, edit)       │  │
│ │ ☑ Shell Execution (exec, process)           │  │
│ │ ☑ Web Search (Brave)                        │  │
│ │ ☑ Web Fetch (Readability)                   │  │
│ │ ☐ Browser Automation (Playwright)           │  │
│ │ ☑ Messaging (send, reply, react)            │  │
│ │ ☑ Cron Jobs (schedule, manage)              │  │
│ │ ☑ Memory Search (vector embeddings)         │  │
│ │ ☐ Image Understanding (vision models)       │  │
│ │ ☐ Text-to-Speech                            │  │
│ │ ☐ Remote Nodes (devices, cameras)           │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ Security                                          │
│ ┌─────────────────────────────────────────────┐  │
│ │ Exec Security: [Allowlist ▼]                │  │
│ │ Allowed: git, npm, python, curl, docker     │  │
│ │                                             │  │
│ │ Sandbox Mode: [Non-Main Sessions ▼]         │  │
│ │ Memory Limit: [512 MB]  CPU Limit: [1 core] │  │
│ │ Network: [Bridge ▼]                         │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ Agent Behavior                                    │
│ ┌─────────────────────────────────────────────┐  │
│ │ Thinking Level: [Medium ▼]                  │  │
│ │ Timeout: [300 seconds]                      │  │
│ │ Typing Indicator: [☑ Enabled]               │  │
│ │ Human-like Delay: [☐ Disabled]              │  │
│ │ Max Concurrent Runs: [3]                    │  │
│ │ Sub-agents: [☑ Enabled]  Max: [2]           │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ Memory & Context                                  │
│ ┌─────────────────────────────────────────────┐  │
│ │ Vector Memory: [☑ Enabled]                  │  │
│ │ Embedding Provider: [Local ▼]               │  │
│ │ Session Memory: [☑ Index transcripts]       │  │
│ │ Context Window: [200000 tokens]             │  │
│ │ Context Pruning: [☑ Enabled]                │  │
│ └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**How it works**: Dashboard writes changes to `openclaw.json` in the shared config volume. The gateway picks up config changes on next heartbeat (or via `gateway.config.apply` tool call). No container restart needed for most settings.

### 12.4 Implementation: Config Passthrough

The simplest approach is a `passthrough` field in `clawforce.yaml` that merges directly into the generated `openclaw.json`:

```yaml
# clawforce.yaml — immediate escape hatch
name: "acme-corp"
role: "inbox-analyst"
# ... standard config ...

# Advanced: merge directly into openclaw.json
openclaw:
  tools:
    profile: "full"
    web:
      search:
        enabled: true
        provider: "brave"
        apiKey: "${BRAVE_API_KEY}"
    exec:
      security: "allowlist"
      safeBins: ["git", "npm", "python"]
  browser:
    enabled: true
    headless: true
  agents:
    defaults:
      sandbox:
        mode: "non-main"
        workspaceAccess: "rw"
      memorySearch:
        enabled: true
        provider: "local"
      thinkingDefault: "medium"
      timeoutSeconds: 300
      subagents:
        maxConcurrent: 2
```

In `generate-openclaw.ts`, deep-merge this into the generated config:

```typescript
// After building the base config...
if (config.openclaw) {
  deepMerge(result, config.openclaw);
}
```

This gives power users full access to every OpenClaw knob without us having to model each one in the Clawforce schema. Then we progressively promote frequently-used settings to first-class `clawforce.yaml` fields with proper validation.

### 12.5 Priority: What to Expose First

| Capability | Why First | Effort |
|-----------|----------|--------|
| **`openclaw` passthrough** | Immediate escape hatch, unblocks everything | 0.5 day |
| **`capabilities.profile`** (minimal/standard/full) | Simple UX, covers 80% of users | 1 day |
| **`browser.enabled` + `browser.headless`** | Research Agent needs this to work | 0.5 day |
| **`tools.web.search`** (provider + API key) | Web search is critical for research agent | 0.5 day |
| **`tools.exec.security`** (allowlist + safeBins) | Security control enterprises need | 0.5 day |
| **`sandbox.mode`** + resource limits | Security isolation for demos | 1 day |
| **`memory.enabled`** + provider | Long-term memory is impressive for demos | 1 day |
| **Dashboard capabilities panel** | Visual config management | 2-3 days |

**Total to expose full OpenClaw capabilities: ~7 days**

The `openclaw` passthrough alone (0.5 day) unblocks everything immediately — users can configure any OpenClaw feature by adding it to the passthrough block. Then we add sugar on top.

---

## Architecture After Expansion

```
+----------------------------------------------------------------------+
|                        CLAWFORCE PLATFORM                             |
|                                                                       |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Multi-Agent      |  | Interactive       |  | Compliance         |  |
|  | Deploy Manager   |  | Cost Explorer     |  | Alert Engine       |  |
|  +------------------+  +-------------------+  +--------------------+  |
|  +------------------+  +-------------------+  +--------------------+  |
|  | 5-Dimension      |  | Approval          |  | PII Detection      |  |
|  | Model Router     |  | Enforcer          |  | v2 (Context)       |  |
|  +------------------+  +-------------------+  +--------------------+  |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Budget Tracker   |  | Routing Feedback  |  | Report             |  |
|  | (per-team)       |  | Loop              |  | Generator          |  |
|  +------------------+  +-------------------+  +--------------------+  |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |              CAPABILITIES LAYER (OpenClaw Passthrough)          |  |
|  |                                                                 |  |
|  |  Browser   Web Search   Exec    Sandbox   Memory   Skills      |  |
|  |  (Playwright) (Brave)  (Shell) (Docker) (Vector) (SKILL.md)   |  |
|  |  Canvas    Web Fetch   Process  Nodes    Sessions  Cron        |  |
|  |  Image     TTS         Gateway  Message  Sub-agents            |  |
|  +-----------------------------------------------------------------+  |
|                                                                       |
|  +-----------------------------+  +------------------------------+    |
|  | Dashboard Config Panel      |  | Capability Profiles          |    |
|  | (toggle tools, security,    |  | minimal | standard | full    |    |
|  |  sandbox, memory at runtime)|  | (opinionated presets)        |    |
|  +-----------------------------+  +------------------------------+    |
|                                                                       |
+----------------------------------+------------------------------------+
                                   |
                      +------------+------------+
                      |    OpenClaw Gateway     |
                      |   28 Tools Available    |
                      |   Multi-Agent Runtime   |
                      +-------------------------+
                      |  Local Ollama (GPU)     |
                      +-------------------------+
```
