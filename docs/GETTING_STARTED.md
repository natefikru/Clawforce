# Clawforce: Technical Integration Guide

**Audience**: Lead engineers integrating Clawforce into their own OpenClaw deployment.

---

## What Clawforce Is

Clawforce is an orchestration layer that sits on top of [OpenClaw](https://github.com/natefikru/openclaw) (an open-source multi-channel AI gateway). It adds five things OpenClaw doesn't have:

1. **Intelligent model routing** — A 5-dimension router that picks the right model per request
2. **PII enforcement** — Regex-based PII detection with adversarial defense, ensuring sensitive data never reaches cloud models
3. **Compliance logging** — Structured audit trail (JSONL + SQLite) with framework profiles (HIPAA, PCI-DSS, GDPR, CCPA, SOX)
4. **Cost intelligence** — Daily budget caps with automatic fallback to local models
5. **Monitoring dashboard** — Next.js dashboard with real-time SSE streaming, alerting, and cost tracking

Clawforce operates as an **OpenClaw plugin**. It hooks into OpenClaw's lifecycle events (`before_agent_start`, `message_sending`, `tool_result_persist`, `agent_end`) to intercept and control agent behavior in your OpenClaw fork.

```
Your Channels (Discord, Slack, email, etc.)
    │
[OpenClaw Gateway]  ← agent runtime, tools, sandboxing
    │
[Clawforce Router Plugin]  ← routing, PII, compliance, cost
    │
    ├── Local Models (Ollama / SGLang / vLLM)  ← PII-safe, cost-free
    └── Cloud Models (provider configured in OpenClaw)  ← capable, metered
```

---

## How It Works: The Request Lifecycle

When a message arrives at the OpenClaw gateway, Clawforce intercepts it at four points:

### 1. `before_agent_start` — Model Selection

The router evaluates the incoming prompt across **5 dimensions** in configurable priority order (first match wins):

| # | Dimension | What It Checks | Effect |
|---|-----------|----------------|--------|
| 0 | **Policy** | Channel/user data tier (restricted, confidential, internal, public) | Restricted/confidential tiers force local model |
| 1 | **Sensitivity** | Regex PII scan (SSN, credit cards, email, phone, IBAN, DOB, IP, passport, driver's license, blocklist keywords) | Any PII match forces local model |
| 2 | **Cost** | Daily budget tracker (per-agent, SQLite-backed) | Over-budget forces fallback model |
| 3 | **Domain** | Heuristic classification (code, writing, analysis, data, conversation) | Routes to domain-specialized models |
| 4 | **Complexity** | Token count, question marks, multi-step indicators | Low → cheap model, High → capable model |

**Critical safety invariant**: Even if custom priority ordering puts domain/cost before sensitivity, a **post-routing safety check** guarantees PII never routes to a cloud model. This is enforced at three independent layers:

- The `evaluateSensitivity()` function forces local when PII is detected
- The `selectModel()` post-routing invariant catches any misconfigured rules
- The `before_agent_start` hook throws a hard error if the final model is cloud + PII

The router returns `modelOverride` and `providerOverride` to OpenClaw, which uses them for the inference call.

### 2. `message_sending` — Output PII Redaction

Before any message leaves the agent, Clawforce scans the outbound text for PII and replaces matches with redaction markers (`[SSN_REDACTED]`, `[EMAIL_REDACTED]`, etc.).

### 3. `tool_result_persist` — Tool Output PII Redaction

When a tool (browser, code execution, etc.) returns results, those results are scanned for PII before being persisted in the conversation history.

### 4. `agent_end` — Session Audit Logging

When an agent session ends, Clawforce logs the session metadata (agent ID, duration, message count, success) to the compliance trail.

---

## Architecture Deep Dive

### Plugin System

Clawforce plugins are TypeScript files compiled to JavaScript via esbuild during `clawforce deploy`. The compiled artifacts land in `clawforce-<name>/config/extensions/<plugin>/`:

```
clawforce-my-agent/
├── config/
│   ├── extensions/
│   │   └── clawforce-router/
│   │       ├── index.js          ← compiled plugin
│   │       ├── index.js.map      ← source maps
│   │       └── openclaw.plugin.json  ← plugin manifest
│   └── openclaw.json             ← generated OpenClaw config
├── docker-compose.yml            ← generated compose file
└── data/
    ├── compliance.jsonl           ← append-only audit log
    ├── routing.jsonl              ← routing decision log
    └── clawforce.db               ← SQLite database
```

The plugin manifest (`openclaw.plugin.json`) declares which hooks the plugin uses and what permissions it requires:

```json
{
  "name": "clawforce-router",
  "hooks": ["before_agent_start", "message_sending", "tool_result_persist", "agent_end"],
  "permissions": ["storage:write", "alerts:dispatch"]
}
```

### Storage Layer

Clawforce uses a **dual-write** strategy:

| Storage | Purpose | Format |
|---------|---------|--------|
| **JSONL files** | Durable append-only log, SIEM export | One JSON object per line |
| **SQLite** (`clawforce.db`) | Fast indexed queries for dashboard and audit CLI | 7 tables, WAL mode |

SQLite tables: `compliance_events`, `routing_decisions`, `budget_state`, `model_health_state`, `alerts`, `dashboard_users`, plus a `migrations` tracking table.

Node.js 22's built-in `node:sqlite` module is used — no external database dependencies.

### Health Monitoring

The `ModelHealthMonitor` class implements a **circuit breaker pattern** for local model providers (Ollama, SGLang, vLLM):

```
                    success >= recoveryThreshold
        ┌──────────────────────────────────────────┐
        │                                          │
   ┌────▼───┐    failures >= failureThreshold   ┌──┴───┐
   │ CLOSED │ ─────────────────────────────────►│ OPEN │
   │(healthy)│                                   │(down) │
   └────┬───┘                                   └──┬───┘
        │                                          │
        │     success (but < recoveryThreshold)    │
        │         ┌───────────┐                    │
        └─────────┤ HALF_OPEN ├────────────────────┘
                  │(degraded) │   timeout/stale
                  └───────────┘
```

Health probes hit provider-specific endpoints:
- **Ollama**: `GET /api/tags`
- **SGLang**: `GET /health` (fallback: `GET /v1/models`)
- **vLLM**: `GET /health` (fallback: `GET /v1/models`)

Probes support configurable retry with delay (`retryAttempts`, `retryDelayMs`).

When a local provider is unhealthy, the **failover policy** determines behavior:

| Policy | PII Request | Non-PII Request |
|--------|-------------|-----------------|
| `block` | Throws error (fail closed) | Throws error |
| `failover-safe` | Throws error (fail closed) | Falls back to cloud default model |
| `queue` | Not implemented — throws error | Not implemented — throws error |

### PII Detection

The PII detector uses regex patterns with **adversarial defense**:

1. **Zero-width character stripping** — Removes `\u200B-\u200D`, `\uFEFF`, soft hyphens, etc.
2. **NFKD normalization** — Expands fullwidth digits (`０-９` → `0-9`), decomposes ligatures
3. **Combining mark removal** — Strips accents left by NFKD
4. **Homoglyph folding** — Maps Cyrillic/Greek lookalikes to Latin (`А` → `A`, `О` → `O`)

Detected PII types and their confidence scores:

| Type | Pattern Example | Confidence |
|------|----------------|------------|
| `ssn` | `123-45-6789` | 0.95 |
| `credit_card` | `4111-1111-1111-1111` | 0.95 |
| `credit_card_amex` | `3782 822463 10005` | 0.95 |
| `email` | `user@example.com` | 0.85 |
| `phone` | `(555) 123-4567` | 0.85 |
| `iban` | `DE89370400440532013000` | 0.90 |
| `dob` | `date of birth: 1990-01-15` | 0.75 |
| `ip_address` | `192.168.1.1` | 0.75 |
| `passport` | `passport number: 123456789` | 0.95 |
| `drivers_license` | `driver's license: D1234567` | 0.85 |
| `blocklist` | Custom keywords | 0.70 |

Confidence thresholds are configurable — you can set a global minimum threshold or per-pattern overrides to tune sensitivity for your use case.

### Budget Tracking

Budget tracking uses **estimated token costs** (not actual). Before routing, the system estimates cost using hardcoded token assumptions:

```typescript
const ESTIMATED_INPUT_TOKENS = 500;
const ESTIMATED_OUTPUT_TOKENS = 1000;
```

These estimates are multiplied by per-model pricing (loaded from a pricing table) to check against daily limits. When over budget, the router falls back to a configured local model.

Budget state is persisted per-agent in SQLite, supporting multi-agent deployments where each agent has independent budget tracking.

### Compliance Framework Profiles

Pre-built profiles define requirements per regulatory framework:

```typescript
// Example: HIPAA profile requirements
{
  name: "hipaa",
  requiredPatterns: ["ssn", "dob", "phone", "email"],
  requiredKeywords: ["patient", "diagnosis", "prescription", "medical record"],
  logRetentionDays: 2190,  // 6 years
  requireEncryption: true,
  requireAccessLog: true,
}
```

Profiles are specified in config and affect which PII patterns are mandatory to scan for and what logging/retention requirements apply.

---

## Getting Started

### Prerequisites

- **Node.js 22+** (required for built-in `node:sqlite`)
- **Docker and Docker Compose** (for deployment)
- **GPU** (recommended for local models — NVIDIA or AMD)

### Installation

```bash
npm install -g clawforce
```

### Minimal Configuration

Create `clawforce.yaml`:

```yaml
name: my-agent

agents:
  - name: inbox-analyst
    role: inbox-analyst

models:
  - name: llama
    id: "ollama/llama3.3:8b"
    type: local
    engine:
      runtime: ollama
      location: container
      model: "llama3.3:8b"
      gpu: nvidia
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"

gateway:
  bind: loopback

dashboard:
  enabled: true
  port: 3000
  auth:
    enabled: false

routing:
  rules:
    - condition: "pii_detected"
      model: "llama"
    - condition: "low_complexity"
      model: "llama"

compliance:
  enabled: true

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
```

### Deploy

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export DISCORD_BOT_TOKEN="..."
clawforce deploy -c clawforce.yaml
```

This generates a Docker Compose stack (OpenClaw gateway + optional Ollama sidecar + dashboard) and starts it.

NOTE: Cloud model API keys are configured inline on each cloud model entry via `api_key`. For environments that use OpenClaw auth profiles instead of environment variables, set the top-level `auth_profile` field. If your cloud model is not Anthropic, configure provider credentials via OpenClaw passthrough and your own secret delivery path.

---

## Full Configuration Reference

```yaml
name: my-agent                         # Deployment name (used for directory, container names)

agents:                                # At least one agent required
  - name: inbox-analyst
    role: inbox-analyst                # inbox-analyst | research-agent | process-automator | supervisor
    runtime: openclaw                  # Optional; defaults to "openclaw"

# Models list — ONLY needed when routing rules reference specific models.
# If no routing rules, no models section needed. OpenClaw passthrough owns the default model.
# Routing rules reference models by name (validated at parse time).
models:
  - name: qwen
    id: "sglang/qwen3-32b"
    type: local
    engine:                            # Engine config inline on local model entries
      runtime: sglang                  # ollama | sglang | vllm
      location: container              # container (managed sidecar) | host (external runtime)
      host_url: "http://host.docker.internal:30000"  # Required/recommended for location=host
      model: "qwen3-32b"
      gpu: nvidia                      # nvidia | amd | none
      quantization: "fp16"
      port: 30000
  - name: llama
    id: "ollama/llama3.3:8b"
    type: local
    engine:
      runtime: ollama
      location: container
      model: "llama3.3:8b"
      gpu: nvidia
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"
  - name: gpt4o
    id: "openai/gpt-4o"
    type: cloud
    api_key: "${OPENAI_API_KEY}"
  - name: gpt4o-mini
    id: "openai/gpt-4o-mini"
    type: cloud
    api_key: "${OPENAI_API_KEY}"

auth_profile: "corp-prod"             # Optional top-level auth profile (replaces old credential_mode)

gateway:
  bind: loopback                       # loopback (default, safe) | lan (exposes to network)
  port: 18789                          # Optional gateway port

routing:                               # Global routing config
  rules:                               # Custom routing rules (first match wins per dimension)
    - condition: "pii_detected"
      model: "llama"                   # References model by name — must be a local model
    - condition: "medium_complexity"
      model: "gpt4o-mini"
    - condition: "high_complexity"
      model: "claude"
    - condition: "low_complexity"
      model: "llama"
    - condition: "domain_code"
      model: "gpt4o"
    - condition: "domain_writing"
      model: "claude"
    - condition: "over_budget"
      model: "llama"
  sensitivity:                         # Sensitivity config (PII detection + keywords)
    keywords:                          # Blocklist words that trigger PII routing
      - "password"
      - "secret"
      - "confidential"
      - "internal-only"
    pii_detection: true                # Enabled by default; disable only for controlled experiments
  priority:                            # Dimension evaluation order
    - policy                           # Channel/user data classification
    - sensitivity                      # PII detection
    - cost                             # Budget check
    - domain                           # Task domain classification
    - complexity                       # Prompt complexity scoring
  budget:
    daily_limit: 10.00                 # USD per day
    fallback_model: "qwen"             # References model by name
  policy:
    default_tier: internal
  health_check:
    enabled: true
    interval_seconds: 10               # How often to probe
    timeout_seconds: 3                 # Probe timeout
    stale_after_seconds: 30            # Mark health as unknown after this
    failover_policy: block             # block | failover-safe | queue (queue not implemented)
    failure_threshold: 3               # Consecutive failures before circuit opens
    recovery_threshold: 2              # Consecutive successes to close circuit
    retry_attempts: 2                  # Retries per probe (0 disables)
    retry_delay_ms: 500                # Delay between retries

compliance:                            # Compliance config (enabled + frameworks)
  enabled: true
  frameworks:                          # Regulatory framework profiles
    - "hipaa"
    - "pci-dss"
    # Also available: gdpr, ccpa, sox

dashboard:
  enabled: true
  port: 3000
  auth:
    enabled: true                      # Required when dashboard.enabled=true
    username: admin
    password: "your-secure-password"   # Min 8 characters

capabilities: full                     # minimal | standard | full
  # minimal: web_search only
  # standard: + browser + memory
  # full: + sandbox + exec + skills + cron

alerts:
  enabled: true
  types:
    model_health: true
    budget_exceeded: true
    pii_violation: true
    agent_error: true
    agent_idle: true
  idle:
    threshold_minutes: 60
    cooldown_minutes: 30
  budget:
    cooldown_minutes: 60
    auto_block_on_exceeded: false      # true = hard block requests when over budget
  notifications:
    dashboard: true
    email:
      enabled: false
      from: "alerts@yourcompany.com"
      to: ["ops@yourcompany.com"]
      smtp_host: "smtp.gmail.com"
      smtp_port: 587
      username: ""
      password: ""

# OpenClaw config passthrough — named map of instances, each merged into generated openclaw.json
openclaw:
  default:                             # Instance name (at least one required)
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
    agents:
      defaults:
        tools:
          sandbox: { enabled: true }
          browser: { enabled: true, headless: true }
```

NOTE: The `models` list is only needed when routing rules reference specific models by name. If you have no routing rules, you can omit it entirely — the OpenClaw passthrough section owns the default model. The old `deployment` section has been removed; runtime defaults to `"openclaw"` per agent and can be overridden with an explicit `runtime` field on each agent. Engine config for local models (ollama, sglang, vllm) is now inline on each local model entry rather than in a separate `local_model` section. `auth_profile` is now a top-level field replacing the old `credential_mode` + `provider_keys` approach.

### Valid Routing Conditions

| Condition | Triggered When |
|-----------|---------------|
| `pii_detected` | Any PII pattern matches in prompt or recent history |
| `low_complexity` | Prompt scores as low complexity (short, simple) |
| `medium_complexity` | Prompt scores as medium complexity (moderate scope/structure) |
| `high_complexity` | Prompt scores as high complexity (long, multi-step) |
| `domain_code` | Prompt classified as programming/technical |
| `domain_writing` | Prompt classified as writing/creative |
| `domain_analysis` | Prompt classified as analysis/reasoning |
| `domain_data` | Prompt classified as data processing |
| `over_budget` | Daily spend exceeds `budget.daily_limit` |

### Model Reference Format

Routing rules reference models by **name** (the `name` field on each model entry). Model IDs use `provider/model-name` format internally:

| Provider | Example ID | Type |
|----------|---------|------|
| `anthropic` | `anthropic/claude-sonnet-4-5` | Cloud |
| `openai` | `openai/gpt-4o` | Cloud |
| `google` | `google/gemini-pro` | Cloud |
| `ollama` | `ollama/llama3.3:8b` | Local |
| `sglang` | `sglang/qwen3-32b` | Local |
| `vllm` | `vllm/mistral-7b` | Local |

Model names in routing rules are validated at parse time against the `models` list. Any model whose `type` is `local` is treated as safe for PII routing and is health-monitored via its `engine` configuration.

---

## CLI Commands

```bash
# Deploy
clawforce deploy -c clawforce.yaml         # Parse config, generate stack, start containers

# Operations
clawforce status                            # Check container health
clawforce stop                              # Stop deployment

# Audit
clawforce audit                             # View container logs (default)
clawforce audit --source compliance         # View JSONL compliance log
clawforce audit --source database           # Query SQLite
clawforce audit --source database --event routing_decision --since 2026-02-15T00:00:00Z
clawforce audit --source database --pii-only
clawforce audit -n 100                      # Last 100 entries

# Routing preview (no deployment needed)
clawforce route-test "fix this TypeScript bug" -c clawforce.yaml
clawforce route-test "my SSN is 123-45-6789" -c clawforce.yaml

# Data migration
clawforce migrate --data-dir ./data         # Backfill JSONL logs into SQLite
clawforce migrate --dry-run                 # Preview without writing

# Dashboard user management
clawforce user add admin -p "password" -r admin
clawforce user list
clawforce user remove admin

# Plugin development
clawforce plugins-bundle -c clawforce.yaml  # One-time compile
clawforce plugins-watch -c clawforce.yaml   # Watch mode for development
```

### Route Test Example

```
$ clawforce route-test "fix this TypeScript bug" -c clawforce.yaml

Model: openai/gpt-4o
Reason: Domain "code" — routing to specialized model
Dimensions:
  PII: no
  Complexity: low
  Domain: code (confidence: 0.14)
  Budget: $0.00/$10.00 remaining
```

---

## Dashboard

The Next.js dashboard (port 3000 by default) provides 5 panels:

| Panel | What It Shows |
|-------|--------------|
| **Agent Status** | Container health, uptime, local model health state |
| **Activity Feed** | Real-time SSE event stream from compliance log |
| **Alerts** | Budget, PII, health, error, idle alerts with acknowledge workflow |
| **Cost Tracker** | Summary, Timeline, and What-If analysis tabs |
| **Task Log** | Recent agent runs with duration and outcome |

**Authentication**: Auth.js v5 with username/password credentials stored in SQLite. RBAC supports `admin` and `viewer` roles. When `dashboard.enabled: true`, you **must** explicitly set `dashboard.auth.enabled` — the system won't start without this being declared.

**SSE Streaming**: The dashboard uses multiplexed Server-Sent Events with cursor-based reconnection, so it recovers gracefully from network interruptions.

---

## Deployment Options

### Cloud-Only (No Local Models)

Simplest setup. All inference goes to cloud APIs. No GPU needed. No `models` section needed since there are no routing rules referencing specific models.

```yaml
name: my-agent
agents:
  - name: inbox-analyst
    role: inbox-analyst
gateway:
  bind: loopback
routing:
  # No PII rules needed — no local model to route to
  # PII safety invariant will BLOCK requests with PII since no local model exists
compliance:
  enabled: true
dashboard:
  enabled: true
  auth:
    enabled: false
openclaw:
  default: {}
```

**Important**: Without a local model configured, any request containing PII will be **blocked** (not routed to cloud). This is by design — the safety invariant prevents PII from reaching cloud providers. If you need to handle PII, you need a local model.

### Hybrid (Local + Cloud)

Recommended for production. PII stays local, complex tasks go cloud.

```yaml
name: my-agent
models:
  - name: llama
    id: "ollama/llama3.3:8b"
    type: local
    engine:
      runtime: ollama
      location: container
      model: "llama3.3:8b"
      gpu: nvidia
      port: 11434
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"
agents:
  - name: inbox-analyst
    role: inbox-analyst
gateway:
  bind: loopback
routing:
  rules:
    - condition: "pii_detected"
      model: "llama"
    - condition: "low_complexity"
      model: "llama"
    - condition: "high_complexity"
      model: "claude"
  budget:
    daily_limit: 10.00
    fallback_model: "llama"
  health_check:
    enabled: true
    failover_policy: failover-safe
compliance:
  enabled: true
dashboard:
  enabled: true
  auth:
    enabled: true
    username: admin
    password: "${DASHBOARD_PASSWORD}"
openclaw:
  default: {}
```

### Mac Mini-First Hybrid (Recommended for local/private setups)

Run OpenClaw + Clawforce in Docker, but keep Ollama native on macOS for best Apple Silicon performance.

```yaml
name: my-agent
models:
  - name: llama
    id: "ollama/llama3.3:8b"
    type: local
    engine:
      runtime: ollama
      location: host
      host_url: "http://host.docker.internal:11434"
      model: "llama3.3:8b"
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"
agents:
  - name: inbox-analyst
    role: inbox-analyst
routing:
  rules:
    - condition: "pii_detected"
      model: "llama"
    - condition: "high_complexity"
      model: "claude"
  budget:
    daily_limit: 10.00
    fallback_model: "llama"
compliance:
  enabled: true
dashboard:
  enabled: true
  auth:
    enabled: true
    username: admin
    password: "${DASHBOARD_PASSWORD}"
openclaw:
  default: {}
```

Notes:
- Start your host runtime first (for example, Ollama on macOS).
- `engine.location: host` on the model entry means Clawforce will not create a runtime sidecar container.
- The gateway still enforces the same PII routing invariants.

### Split Architecture (Production)

Gateway on a cheap VPS, GPU inference on a separate server.

Use host location mode on the model entry and point the engine endpoint at your remote inference server or load balancer:

```yaml
models:
  - name: llama
    id: "ollama/llama3.3:8b"
    type: local
    engine:
      runtime: ollama                  # or sglang / vllm
      location: host
      host_url: "http://gpu-server.internal:11434"
      model: "llama3.3:8b"
```

Ensure your routing rules reference local model names so PII invariants remain local-only.

---

## Agent Role Templates

Clawforce ships role templates that generate OpenClaw SKILL.md instructions and config fragments:

| Role | Description | Key Behaviors |
|------|-------------|---------------|
| `inbox-analyst` | Monitors channels, summarizes threads, flags action items | Channel watching, thread summarization, priority flagging |
| `research-agent` | Takes research requests, browses web, compiles reports | Web research, report generation, citation management |
| `process-automator` | Cron-triggered browser workflows, reports results | Scheduled tasks, browser automation, result reporting |
| `supervisor` | Monitors supervised agents and reports workforce status | Agent oversight, escalation, workforce health summaries |

Each template lives in `templates/roles/<name>/` with:
- `SKILL.md` — Agent behavior instructions (injected into OpenClaw agent config)
- `config.partial.json` — OpenClaw config fragment (tools, capabilities)
- `README.md` — Setup guide

---

## How the Config Pipeline Works

```
clawforce.yaml
      │
      ▼
[1. YAML Parse + Env Var Expansion]
      │  readFileSync → parseYaml → expandEnvVars (${VAR} substitution)
      │
      ▼
[2. Zod Schema Validation]
      │  ClawforceConfigSchema.safeParse()
      │  Validates types, ranges, required fields, cross-field constraints
      │
      ▼
[3. OpenClaw Config Generation]
      │  generate-openclaw.ts → openclaw.json
      │  Merges role template + router plugin config + openclaw passthrough
      │
      ▼
[4. Docker Compose Generation]
      │  generate-compose.ts → docker-compose.yml
      │  Gateway container + optional Ollama/SGLang/vLLM sidecar + dashboard
      │
      ▼
[5. Plugin Compilation]
      │  esbuild: TypeScript → JavaScript bundles
      │  Output: extensions/clawforce-router/index.js
      │
      ▼
[6. Security Audit Gate]
      │  Runs `openclaw security audit --deep` inside the gateway container
      │  Blocks deployment on critical findings
      │  Skip with CLAWFORCE_SKIP_SECURITY_AUDIT=1
      │
      ▼
[7. Docker Compose Up]
      docker compose up -d
```

---

## Extending Clawforce

### Custom Routing Rules

The routing engine is rule-based with dimension prioritization. To add custom behavior:

1. **Add sensitivity keywords** for domain-specific PII:
   ```yaml
   routing:
     sensitivity:
       keywords:
         - "patient_id"
         - "mrn"        # Medical Record Number
         - "account_number"
   ```

2. **Customize dimension priority** — e.g., always check budget before domain:
   ```yaml
   routing:
     priority: [policy, sensitivity, cost, complexity, domain]
   ```

3. **Per-pattern PII thresholds** — tune which PII patterns trigger routing:
   ```yaml
   # In the PII detector options (passed via plugin config)
   # threshold: 0.80 means only matches with confidence >= 0.80 count
   # ip_address (0.75) and dob (0.75) would be ignored
   ```

### Custom Compliance Profiles

The compliance profile system (`compliance-profiles.ts`) defines per-framework requirements. To add a custom profile, you'd extend the `COMPLIANCE_PROFILES` map with your framework's pattern requirements, keyword requirements, and retention policies.

### OpenClaw Passthrough

The `openclaw:` key in `clawforce.yaml` is a named map of OpenClaw instances. Each instance's config is merged directly into the generated `openclaw.json`. This gives you full access to OpenClaw's configuration without Clawforce needing to understand every OpenClaw option:

```yaml
openclaw:
  default:
    agents:
      defaults:
        tools:
          sandbox: { enabled: true }
          browser: { enabled: true, headless: true }
          memory: { enabled: true }
        model:
          temperature: 0.7
          maxTokens: 4096
```

---

## Testing

```bash
# Run all tests (878 tests, ~2 seconds)
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# Dashboard tests (140 tests)
cd clawforce-dashboard && pnpm test

# Coverage report (80% lines/functions/statements, 75% branches enforced)
pnpm test:coverage

# Type checking
pnpm typecheck

# Dead code detection
pnpm knip --include dependencies,unlisted,unresolved
```

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **OpenClaw plugin in a forked deployment** | Hooks (`before_agent_start`, `message_sending`, `tool_result_persist`, `agent_end`) provide all needed interception points. Clawforce remains plugin-oriented even when running on a maintained OpenClaw fork. |
| **SQLite + JSONL dual-write** | JSONL is the durable write-ahead log for SIEM export. SQLite (Node.js 22 built-in) provides fast indexed queries. Same pattern OpenClaw uses internally. |
| **Regex PII, not ML** | Deterministic, fast, auditable. No model loading overhead. Adversarial defense (homoglyph folding, NFKD normalization) covers most evasion techniques. ML-based detection is on the roadmap (Phase 4). |
| **Docker Compose, not K8s** | Simpler debugging, faster iteration, sufficient for single-tenant through Phase 3. Kubernetes deployment planned for Phase 4. |
| **Single gateway for multi-agent** | OpenClaw's `before_agent_start` hook receives `ctx.agentId`, enabling per-agent routing within one process. OpenClaw's 8-tier binding system natively routes messages to the correct agent. |
| **Estimated token costs, not actual** | Budget tracking uses hardcoded estimates (500 input, 1000 output tokens) because OpenClaw doesn't expose actual token counts via hooks. This is a known limitation. |

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (referenced via `api_key` on cloud model entries) | — |
| `OPENAI_API_KEY` | OpenAI API key (referenced via `api_key` on cloud model entries) | — |
| `OLLAMA_HOST` | Ollama endpoint for health probes | `http://ollama:11434` |
| `SGLANG_HOST` | SGLang endpoint for health probes | `http://sglang:30000` |
| `VLLM_HOST` | vLLM endpoint for health probes | `http://vllm:8000` |
| `CLAWFORCE_SKIP_SECURITY_AUDIT` | Skip OpenClaw security audit gate | `0` |
| `DISCORD_BOT_TOKEN` | Discord bot token | — |

NOTE: Cloud model API keys are configured inline on each cloud model entry via `api_key` (supports `${ENV_VAR}` expansion). For environments that use OpenClaw auth profiles, set the top-level `auth_profile` field instead.

---

## Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 22+ | Latest LTS |
| Docker | 20+ | Latest |
| Docker Compose | v2+ | Latest |
| RAM (gateway only) | 2 GB | 4 GB |
| RAM (per concurrent agent) | — | +8 GB each |
| GPU VRAM (local models) | 16 GB | 24-48 GB |
