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
router:
  enabled: true
compliance:
  enabled: true
dashboard:
  enabled: true
  port: 3000
ollama:
  enabled: true
  model: "qwen3:32b"
EOF

# Deploy
clawforce deploy -c clawforce.yaml
```

This starts an OpenClaw gateway, a local model via SGLang/Ollama, the compliance logger, and the monitoring dashboard — all via Docker Compose.

## Features

### Model Router

Routes every request across 5 dimensions to pick the right model:

- **Sensitivity** — PII detection (SSN, credit cards, emails, phone numbers, passports, IBANs, IP addresses) with adversarial defense (unicode normalization, homoglyph folding, zero-width character stripping)
- **Policy** — Channel and user-based data classification (restricted, confidential, internal, public)
- **Complexity** — Heuristic scoring routes simple prompts to cheap local models, complex prompts to capable cloud models
- **Domain** — Classifies prompts (code, writing, analysis, data, conversation) for specialized model routing
- **Budget** — Daily spend limits with automatic fallback to local models when over budget

PII never routes to cloud models. This is enforced as a post-routing safety invariant regardless of configuration.

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

### Compliance Logging

Every agent action is captured as structured JSONL:
- Tool executions (name, success, duration)
- Messages received and sent (channel, content length, model used)
- Routing decisions (model, reason, PII types, dimension)
- Session lifecycle events

### Compliance Framework Profiles

Pre-built profiles for common regulatory frameworks:
- **HIPAA** — Healthcare data protection
- **PCI-DSS** — Payment card security
- **GDPR** — EU data protection
- **CCPA** — California consumer privacy
- **SOX** — Financial reporting controls

### Activity Dashboard

Next.js dashboard with 4 panels:
- **Agent Status** — Container health, uptime
- **Activity Feed** — Real-time event streaming from compliance log
- **Cost Tracker** — Gateway-sourced cost data with Summary, Timeline, and What-If analysis tabs
- **Task Log** — Recent agent runs with duration and outcome

### Agent Role Templates

Three starter templates included:
- **Inbox Analyst** — Monitors Slack, summarizes threads, flags action items
- **Research Agent** — Takes requests via Slack, browses web, compiles reports
- **Process Automator** — Cron-triggered browser workflows, reports results

## CLI

```bash
clawforce deploy -c clawforce.yaml     # Deploy from config
clawforce status                        # Check container health
clawforce stop                          # Stop deployment
clawforce audit                         # View container logs
clawforce audit --source compliance     # View structured compliance log
clawforce audit -n 100                  # Last 100 entries
clawforce route-test "your prompt"      # Test routing decision without deploying
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

router:
  enabled: true
  defaultModel: "anthropic/claude-sonnet-4-5"
  defaultLocalModel: "sglang/qwen3-32b"
  rules: []                      # Custom routing rules
  sensitivity_keywords: []       # Additional PII keywords
  priority:                      # Dimension evaluation order
    - sensitivity
    - cost
    - domain
    - complexity
  budget:
    daily_limit: 10.00
    fallback_model: "sglang/qwen3-32b"

compliance:
  enabled: true

dashboard:
  enabled: true
  port: 3000

ollama:
  enabled: true
  model: "qwen3:32b"
  gpu: nvidia                    # nvidia | amd | none

capabilities: full               # minimal | standard | full

# Direct OpenClaw config passthrough
openclaw:
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
|   (5-dim routing)|     | (JSONL logging)  |     |   (Next.js)      |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         v                        v                        v
+------------------------------------------------------------------+
|                     OpenClaw Gateway                              |
|          (agent runtime, tools, channels, sandbox)               |
+------------------------------------------------------------------+
         |                                          |
         v                                          v
+------------------+                    +------------------+
|  Local Models    |                    |  Cloud Models    |
|  SGLang / Ollama |                    |  Anthropic, etc  |
+------------------+                    +------------------+
```

The router plugin hooks into `before_agent_start` to override model selection, `message_sending` and `tool_result_persist` to redact PII from outputs, and `agent_end` for session audit logging.

## Development

```bash
git clone https://github.com/natefikru/clawforce.git
cd clawforce
npm install
npm test           # 545 tests
```

Dashboard:

```bash
cd clawforce-dashboard
npm install
npm test           # 45 tests
```

### Test Coverage

Main project enforces 80% coverage thresholds (lines, functions, statements) and 75% branch coverage.

## Requirements

- Node.js 20+
- Docker and Docker Compose
- GPU recommended for local models (NVIDIA or AMD)

## License

MIT
