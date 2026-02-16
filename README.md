# Clawforce

Deploy autonomous AI agents on your infrastructure with intelligent model routing, PII protection, and compliance logging. Built on [OpenClaw](https://github.com/natefikru/openclaw).

Your data never leaves your machines. Sensitive requests route to local models automatically.

## Quick Start

```bash
npm install -g clawforce

# Create a config file
cat > clawforce.yaml << 'EOF'
name: my-agent
role: inbox-analyst
models:
  primary: "anthropic/claude-sonnet-4-5"
  credential_mode: env
  api_key: "${ANTHROPIC_API_KEY}"
gateway:
  bind: loopback
dashboard:
  enabled: true
  port: 3000
  auth:
    enabled: false
router:
  enabled: true
compliance:
  enabled: true
openclaw:
  channels:
    discord:
      enabled: true
      token: "${DISCORD_BOT_TOKEN}"
ollama:
  enabled: true
  model: "qwen3.3:8b"
EOF

# Deploy
clawforce deploy -c clawforce.yaml
```

This starts an OpenClaw gateway, a local model via SGLang/Ollama, the compliance logger, and the monitoring dashboard — all via Docker Compose.

Secure-by-default deployment behavior:
- Gateway binds to `loopback` unless explicitly set to `gateway.bind: lan`.
- Dashboard requires an explicit auth policy whenever dashboard is enabled.
- Deploy runs an OpenClaw security audit gate and blocks on critical findings.

## Features

### Model Router

Routes every request across 5 dimensions to pick the right model:

- **Sensitivity** — PII detection (SSN, credit cards, emails, phone numbers, passports, IBANs, IP addresses) with adversarial defense (unicode normalization, homoglyph folding, zero-width character stripping)
- **Policy** — Channel and user-based data classification (restricted, confidential, internal, public)
- **Complexity** — Heuristic scoring routes simple prompts to cheap local models, complex prompts to capable cloud models
- **Domain** — Classifies prompts (code, writing, analysis, data, conversation) for specialized model routing
- **Budget** — Daily spend limits with automatic fallback to local models when over budget

PII never routes to cloud models. This is enforced as a post-routing safety invariant regardless of configuration.

### Model Health and Failover

Local model runtimes are actively health-checked (Ollama, SGLang, vLLM) with circuit-breaker behavior. When a selected local provider is unhealthy:

- `block` denies the request.
- `failover-safe` allows only non-sensitive requests to fall back to cloud.
- `queue` is currently not implemented as deferred execution and is treated as fail-closed.

```yaml
router:
  health_check:
    enabled: true
    failover_policy: block      # block | failover-safe
```

```yaml
router:
  enabled: true
  rules:
    - condition: "pii_detected"
      model: "sglang/qwen3-32b"
    - condition: "high_complexity"
      model: "anthropic/claude-sonnet-4-5"
    - condition: "domain_code"
      model: "openai/gpt-4o"
    - condition: "over_budget"
      model: "sglang/qwen3-32b"
  sensitivity_keywords: ["password", "secret", "confidential"]
  priority: ["sensitivity", "cost", "domain", "complexity"]
  budget:
    daily_limit: 10.00
    fallback_model: "sglang/qwen3-32b"
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

**Authentication** — Auth.js v5 with username/password credentials stored in SQLite. Dashboard-enabled configs must explicitly declare an auth policy (`dashboard.auth.enabled: true|false`). This avoids accidental insecure defaults.

### Agent Role Templates

Three starter templates included:
- **Inbox Analyst** — Monitors channel activity, summarizes threads, flags action items
- **Research Agent** — Takes requests via configured channels, browses web, compiles reports
- **Process Automator** — Cron-triggered browser workflows, reports results

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

## Configuration

Full `clawforce.yaml` reference:

```yaml
name: my-agent
role: inbox-analyst              # inbox-analyst | research-agent | process-automator

models:
  primary: "anthropic/claude-sonnet-4-5"
  local: "sglang/qwen3-32b"
  credential_mode: env           # env | auth_profile
  api_key: "${ANTHROPIC_API_KEY}"  # used when credential_mode=env
  # auth_profile: "corp-prod"      # required when credential_mode=auth_profile

gateway:
  bind: loopback                 # loopback | lan

router:
  enabled: true
  rules: []                      # Custom routing rules
  sensitivity_keywords: []       # Additional PII keywords
  priority:                      # Dimension evaluation order
    - policy
    - sensitivity
    - cost
    - domain
    - complexity
  budget:
    daily_limit: 10.00
    fallback_model: "sglang/qwen3-32b"
  health_check:
    enabled: true
    failover_policy: block       # block | failover-safe (queue not implemented)

compliance:
  enabled: true

dashboard:
  enabled: true
  port: 3000
  auth:                          # Required whenever dashboard.enabled=true
    enabled: true
    username: admin
    password: "your-secure-password"  # Min 8 characters
  # To explicitly run an open dashboard, set:
  # auth:
  #   enabled: false

ollama:
  enabled: true
  model: "qwen3.3:8b"
  gpu: nvidia                    # nvidia | amd | none

capabilities: full               # minimal | standard | full

# Alerting and notifications
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

# Direct OpenClaw config passthrough
openclaw:
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

## Development

```bash
git clone https://github.com/natefikru/clawforce.git
cd clawforce
pnpm install
pnpm test           # 712 tests
```

Dashboard:

```bash
cd clawforce-dashboard
pnpm install
pnpm test           # 140 tests
```

### Plugin Build Pipeline

Clawforce now bundles OpenClaw plugins to JavaScript during workspace setup/deploy.

- Output directory: `clawforce-<name>/config/extensions/<plugin>/`
- Artifacts: `index.js`, `index.js.map`, and `openclaw.plugin.json`
- Raw TypeScript plugin source files are not copied to extensions output

For local plugin development, use watch mode:

```bash
# One-shot bundle
clawforce plugins-bundle -c clawforce.yaml

# Default output path is based on config file location:
# <config-dir>/clawforce-<name>/config/extensions
clawforce plugins-watch -c clawforce.yaml

# Optional custom output path
clawforce plugins-bundle -c clawforce.yaml --extensions-dir /path/to/extensions
clawforce plugins-watch -c clawforce.yaml --extensions-dir /path/to/extensions

# Optional plugin filter
clawforce plugins-bundle -c clawforce.yaml --router
clawforce plugins-bundle -c clawforce.yaml --compliance
clawforce plugins-watch -c clawforce.yaml --router
clawforce plugins-watch -c clawforce.yaml --compliance
```

### Test Coverage

Main project enforces 80% coverage thresholds (lines, functions, statements) and 75% branch coverage.

## Requirements

- Node.js 22+ (required for built-in `node:sqlite`)
- Docker and Docker Compose
- GPU recommended for local models (NVIDIA or AMD)

## License

MIT
