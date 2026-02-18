# Clawforce

<p align="center">
  <img src="docs/assets/clawforce-logo.png" alt="Clawforce logo" width="280" />
</p>

**Enterprise AI agent management for teams that can't afford to get security wrong.**

Clawforce deploys, routes, and monitors autonomous AI agents on your infrastructure — with built-in PII protection, compliance logging, and intelligent cost optimization. Your data never leaves your network. Sensitive requests route to local models automatically.

Built on [OpenClaw](https://github.com/openclaw/openclaw), the open-source multi-channel AI gateway.

---

## 30-Second Overview

Clawforce is a control plane for OpenClaw that answers three practical questions:

1. **Which model should handle this message?**  
   Route by sensitivity, policy, complexity, domain, and budget.
2. **Can we prove what the agent did?**  
   Capture structured audit events (JSONL + SQLite) and compliance-friendly records.
3. **Can we run this safely in production?**  
   Deploy with secure defaults, model health checks, and runtime visibility.

Use Clawforce when you want OpenClaw agents in production with stronger controls for security, spend, and operations.

## What It Adds On Top of OpenClaw

- **Intelligent model routing** — A 5-dimension router (PII sensitivity, data policy, complexity, domain, budget) selects the right model per request.
- **Cost controls** — Daily budget caps plus automatic fallback to local models when limits are exceeded.
- **Compliance-ready logging** — Structured logs and a queryable SQLite store, with profiles for HIPAA, PCI-DSS, GDPR, CCPA, and SOX.
- **Operational dashboard** — Agent health, activity, alerts, and cost trends in one place.
- **One-command deployment** — One YAML config and `clawforce deploy` to generate and run the stack with Docker Compose.

```
Customer Infrastructure (channels, tools, data)
    │
[Clawforce]  ← orchestration, security, compliance, cost intelligence
    │
[OpenClaw]   ← open-source AI gateway (20+ channels, 15+ LLM providers)
    │
[LLM Providers]  ← Anthropic, OpenAI, Google, or local models (Ollama, vLLM, SGLang)
```

## Why It Matters

| Value | Proof Point |
|-------|------------|
| **Cost savings** | Mixed workloads can reduce cloud spend by routing simple tasks to local models first |
| **Data sovereignty** | PII is enforced as a safety invariant and blocked from cloud routing |
| **Compliance** | Full audit trail with model, reason, and PII classification per decision |
| **Operational visibility** | Dashboard with health, activity, alerts, cost tracking, and what-if analysis |
| **Time to value** | One YAML file, one command: `clawforce deploy` |

---

## Quick Start

```bash
npm install -g clawforce

# Create a config file
cat > clawforce.yaml << 'EOF'
name: my-agent

agents:
  - name: my-agent
    role: supervisor
    supervises: []

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
  sensitivity:
    pii_detection: true
    keywords: ["password", "secret"]

compliance:
  enabled: true

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
EOF

# Deploy
clawforce deploy -c clawforce.yaml
```

This starts an OpenClaw gateway, a local model via the configured engine, the compliance logger, and the monitoring dashboard — all via Docker Compose.

Secure-by-default deployment behavior:
- Gateway binds to `loopback` unless explicitly set to `gateway.bind: lan`.
- Dashboard requires an explicit auth policy whenever dashboard is enabled.
- Deploy runs an OpenClaw security audit gate and blocks on critical findings.

---

## Features

### 5-Dimension Model Router

Routes every request across 5 dimensions to pick the right model:

- **Sensitivity** — PII detection (SSN, credit cards, emails, phone numbers, passports, IBANs, IP addresses) with adversarial defense (unicode normalization, homoglyph folding, zero-width character stripping)
- **Policy** — Channel and user-based data classification (restricted, confidential, internal, public)
- **Complexity** — Heuristic scoring routes simple prompts to cheap local models, complex prompts to capable cloud models
- **Domain** — Classifies prompts (code, writing, analysis, data, conversation) for specialized model routing
- **Budget** — Daily spend limits with automatic fallback to local models when over budget

PII never routes to cloud models. This is enforced as a post-routing safety invariant regardless of configuration.

```yaml
routing:
  rules:
    - condition: "pii_detected"
      model: "qwen"                    # references model by name from models list
    - condition: "medium_complexity"
      model: "gpt4o-mini"
    - condition: "high_complexity"
      model: "claude"
    - condition: "domain_code"
      model: "gpt4o"
    - condition: "over_budget"
      model: "qwen"
  sensitivity:
    keywords: ["password", "secret", "confidential"]
    pii_detection: true
  priority: ["sensitivity", "cost", "domain", "complexity"]
  budget:
    daily_limit: 10.00
    fallback_model: "qwen"
```

### Model Health and Failover

Local model runtimes are actively health-checked (Ollama, SGLang, vLLM) with circuit-breaker behavior. When a selected local provider is unhealthy:

- `block` denies the request.
- `failover-safe` allows only non-sensitive requests to fall back to cloud.

```yaml
routing:
  health_check:
    enabled: true
    failover_policy: block      # block | failover-safe
    retry_attempts: 2           # probe retries before marking failure
    retry_delay_ms: 500         # delay between probe retries
```

PII confidence filtering is configurable within the routing section:

```yaml
routing:
  sensitivity:
    pii_detection: true              # default true; set false only for controlled experiments
    keywords: ["secret"]             # additional keywords for sensitivity detection
    pii_confidence_threshold: 0.80
    pii_pattern_thresholds:
      ip_address: 0.50
```

### Output Filtering

Outbound messages and tool results are scanned for PII before leaving the agent. Matches are replaced with redaction markers like `[SSN_REDACTED]`, `[EMAIL_REDACTED]`, etc.

### Deployment Security Gate

`clawforce deploy` runs `openclaw security audit --deep` inside the gateway container and fails deployment on critical findings. For local-only iteration, you can bypass this with `CLAWFORCE_SKIP_SECURITY_AUDIT=1`.

### Compliance Logging

Every agent action is captured as structured JSONL and SQLite:
- Tool executions (name, success, duration)
- Messages received and sent (channel, content length, model used)
- Routing decisions (model, reason, PII types, dimension)
- Session lifecycle events
- Budget state tracking (daily spend, request counts)

Data is dual-written: JSONL files remain the source of truth for durability and SIEM export, while SQLite provides fast indexed queries for the dashboard and audit CLI.

### Compliance Framework Profiles

Pre-built profiles for common regulatory frameworks:
- **HIPAA** — Healthcare data protection
- **PCI-DSS** — Payment card security
- **GDPR** — EU data protection
- **CCPA** — California consumer privacy
- **SOX** — Financial reporting controls

### Activity Dashboard

Next.js dashboard with 5 panels:
- **Agent Status** — Container health, uptime, and local model health state
- **Activity Feed** — Real-time event streaming from compliance log
- **Alerts** — Real-time operational alerts with acknowledge workflow (budget, PII, health, errors, idle agents)
- **Cost Tracker** — Gateway-sourced cost data with Summary, Timeline, and What-If analysis tabs
- **Task Log** — Recent agent runs with duration and outcome

**Authentication** — Auth.js v5 with username/password credentials stored in SQLite. Dashboard-enabled configs must explicitly declare an auth policy (`dashboard.auth.enabled: true|false`).

### Multi-Agent Deployments

Deploy multiple specialized agents from a single config, each with its own role, channels, and budget:

```yaml
name: my-workforce

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

agents:
  - name: ops-supervisor
    role: supervisor
    supervises: [research-agent]
    routing:
      budget:
        daily_limit: 5.00
        fallback_model: "llama"
  - name: research-agent
    role: research-agent
    routing:
      budget:
        daily_limit: 10.00
        fallback_model: "llama"

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
```

Per-agent budget isolation, channel routing, and supervisor hierarchies. See [docs/MULTI-AGENT.md](docs/MULTI-AGENT.md) for the full reference.

### Agent Role Templates

Three starter templates included:
- **Supervisor** — Coordinates specialist agents and manages escalations
- **Research Agent** — Takes requests via configured channels, browses web, compiles reports
- **Process Automator** — Cron-triggered browser workflows, reports results

---

## CLI

```bash
clawforce deploy -c clawforce.yaml     # Deploy from config
clawforce status                        # Check container health
clawforce stop                          # Stop deployment
clawforce audit                         # View container logs
clawforce audit --source compliance     # View structured compliance log
clawforce audit --source database       # Query SQLite database directly
clawforce audit --source database --event tool_call --since 2026-02-15T00:00:00Z
clawforce audit --source database --pii-only  # PII routing decisions only
clawforce audit -n 100                  # Last 100 entries
clawforce migrate --data-dir ./data     # Backfill JSONL logs into SQLite
clawforce migrate --dry-run             # Preview migration without writing
clawforce route-test "your prompt"      # Test routing decision without deploying
clawforce user add admin -p "password" -r admin   # Add dashboard user
clawforce user list                     # List dashboard users
clawforce user remove admin             # Remove dashboard user
```

### Route Test

Preview routing decisions before deploying:

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

## Configuration

Full `clawforce.yaml` reference:

```yaml
name: my-agent

# Agents array — at least one agent required. No separate "single-agent" mode.
# Runtime defaults to "openclaw" per agent; override with an explicit runtime field.
agents:
  - name: my-agent
    role: supervisor             # inbox-analyst | research-agent | process-automator | supervisor
    supervises: [helper-agent]   # Required for supervisor role; list of agent names this agent manages
    openclaw: default            # Optional; required when multiple openclaw instances are defined
    runtime: openclaw            # Optional; defaults to "openclaw"
    routing:                     # Optional per-agent routing overrides
      budget:
        daily_limit: 5.00
        fallback_model: "qwen"   # references model by name
      rules:
        - condition: high_complexity
          model: "claude"        # references model by name
  - name: helper-agent
    role: research-agent

# Models list — ONLY needed when routing rules reference specific models.
# If no routing rules, no models section needed. The OpenClaw passthrough section
# owns the default model via the openclaw config.
# Routing rules reference models by name (validated at parse time).
models:
  - name: qwen
    id: "sglang/qwen3-32b"
    type: local
    engine:
      runtime: sglang              # ollama | sglang | vllm
      location: container          # container | host
      model: "qwen3-32b"
      gpu: nvidia                  # nvidia | amd | none
      port: 30000                  # engine port (sglang default: 30000)
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"

auth_profile: "corp-prod"         # Optional top-level auth profile (replaces old credential_mode)

gateway:
  bind: loopback                 # loopback | lan
  port: 18789                    # Optional gateway port

routing:
  rules: []                      # Custom routing rules (pii_detected | low_complexity | medium_complexity | high_complexity | domain_* | over_budget)
  priority:                      # Dimension evaluation order
    - policy
    - sensitivity
    - cost
    - domain
    - complexity
  sensitivity:
    keywords: []                 # Sensitivity keywords for PII-adjacent content
    pii_detection: true          # Enabled by default
    pii_confidence_threshold: 0.80  # 0.0..1.0 global minimum confidence
    pii_pattern_thresholds:      # Optional per-pattern overrides
      ip_address: 0.50
  policy:
    default_tier: internal       # restricted | confidential | internal | public
  budget:
    daily_limit: 10.00
    fallback_model: "qwen"       # references model by name
  health_check:
    enabled: true
    failover_policy: block       # block | failover-safe (queue not implemented)
    retry_attempts: 2            # 0..5, default 2
    retry_delay_ms: 500          # 0..5000, default 500

compliance:
  enabled: true
  frameworks:                    # Optional compliance framework profiles
    - hipaa
    - gdpr

dashboard:
  enabled: true
  port: 3000
  auth:                          # Required whenever dashboard.enabled=true
    enabled: true
    username: admin
    password: "your-secure-password"  # Min 8 characters

capabilities: full               # minimal | standard | full

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
    auto_block_on_exceeded: false
  notifications:
    dashboard: true
    email:
      enabled: false
      from: ""
      to: []
      smtp_host: ""
      smtp_port: 587
      username: ""
      password: ""

# Named map of OpenClaw configs — each key is an instance name, value is raw passthrough.
# Use multiple named instances to run agents against different OpenClaw configurations.
openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
    agents:
      defaults:
        tools:
          sandbox: { enabled: true }
          browser: { enabled: true, headless: true }
  # Example: a second instance for a different channel setup
  # research:
  #   channels:
  #     slack:
  #       enabled: true
  #       token: "${SLACK_BOT_TOKEN}"
```

NOTE: The `models` list is only needed when routing rules reference specific models by name. If you have no routing rules, you can omit it entirely — the OpenClaw passthrough section owns the default model. The old `deployment` section has been removed; runtime defaults to `"openclaw"` per agent and can be overridden with an explicit `runtime` field on each agent. Engine config for local models (ollama, sglang, vllm) is now inline on each local model entry rather than in a separate `local_model` section.

---

## Architecture

```
clawforce deploy
      |
      v
+------------------+     +------------------+     +------------------+
|   Router Plugin  |     | Compliance Plugin|     |    Dashboard     |
|   (5-dim routing)|     | (JSONL + SQLite) |     |   (Next.js)      |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         v                        v                        v
+------------------------------------------------------------------+
|                     OpenClaw Gateway                              |
|          (agent runtime, tools, channels, sandbox)               |
+------------------------------------------------------------------+
         |                        |                        |
         v                        v                        v
+------------------+    +------------------+    +------------------+
|  Local Models    |    |  Cloud Models    |    |  SQLite Storage  |
|  SGLang / Ollama |    |  Anthropic, etc  |    |  (clawforce.db)  |
+------------------+    +------------------+    +------------------+
```

The router plugin hooks into `before_agent_start` to override model selection, `message_sending` and `tool_result_persist` to redact PII from outputs, and `agent_end` for session audit logging.

---

## Development

```bash
git clone https://github.com/natefikru/clawforce.git
cd clawforce
pnpm install
pnpm test
```

Dashboard:

```bash
cd clawforce-dashboard
pnpm install
pnpm test           # 140 tests
```

### Plugin Build Pipeline

Clawforce bundles OpenClaw plugins to JavaScript during workspace setup/deploy.

- Output directory: `clawforce-<name>/config/extensions/<plugin>/`
- Artifacts: `index.js`, `index.js.map`, and `openclaw.plugin.json`

For local plugin development, use watch mode:

```bash
clawforce plugins-bundle -c clawforce.yaml
clawforce plugins-watch -c clawforce.yaml
```

### Test Coverage

Main project enforces 80% coverage thresholds (lines, functions, statements) and 75% branch coverage.

## Requirements

- Node.js 22+ (required for built-in `node:sqlite`)
- Docker and Docker Compose
- GPU recommended for local models (NVIDIA or AMD)

## License

MIT
