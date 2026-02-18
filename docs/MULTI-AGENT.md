# Multi-Agent Configuration

Clawforce supports deploying multiple specialized AI agents from a single config file. Each agent has its own role, routing overrides, and budget — managed through one gateway.

## Overview

Multi-agent configs use a top-level `agents[]` array alongside shared `models`, `routing`, and `dashboard` config. The gateway remains a single process; OpenClaw handles per-agent routing via named instance bindings.

**Key concepts:**
- **`models`** — Shared model config (cloud, local, credentials) used by all agents
- **`agents[]`** — Per-agent role, openclaw instance reference, and routing overrides
- **`openclaw`** — Named map of OpenClaw instances with passthrough config

## Example Config

```yaml
name: my-workforce

deployment:
  agent_runtime: openclaw

models:
  cloud: "anthropic/claude-sonnet-4-5"
  local: "ollama/llama3.3:8b"
  credential_mode: env
  provider_keys:
    anthropic: "${ANTHROPIC_API_KEY}"

routing:
  priority: [policy, sensitivity, cost, domain, complexity]
  sensitivity:
    keywords: [password, secret]

dashboard:
  enabled: true
  auth:
    enabled: false

agents:
  - name: inbox-analyst
    role: inbox-analyst
    routing:
      budget:
        daily_limit: 5.00

  - name: research-agent
    role: research-agent
    routing:
      budget:
        daily_limit: 10.00
      rules:
        - condition: high_complexity
          model: anthropic/claude-sonnet-4-5

  - name: ops-supervisor
    role: supervisor
    supervises: [inbox-analyst, research-agent]
    routing:
      budget:
        daily_limit: 3.00

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"

local_model:
  engine: "ollama"
  location: "container"
  model: "llama3.3:8b"
  gpu: "nvidia"
```

## Schema Reference

### `models` (top-level, shared by all agents)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `models.cloud` | string | Yes | Cloud model for all agents |
| `models.local` | string | No | Local/fallback model |
| `models.credential_mode` | `env` \| `auth_profile` | No | How API keys are resolved (default: `env`) |
| `models.provider_keys` | map | No | Provider API keys (required when `credential_mode=env` and cloud model used) |
| `models.auth_profile` | string | No | OpenClaw auth profile name (required when `credential_mode=auth_profile`) |

### `agents[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent identifier (lowercase alphanumeric + hyphens, max 50 chars) |
| `role` | enum | Yes | `inbox-analyst`, `research-agent`, `process-automator`, or `supervisor` |
| `openclaw` | string | No | OpenClaw instance name (required when multiple openclaw instances are defined) |
| `routing` | object | No | Per-agent routing overrides |
| `skills` | array | No | Additional skill IDs |
| `supervises` | array | No | Names of agents this agent supervises |

### Per-Agent Routing

```yaml
routing:
  budget:
    daily_limit: 5.00                     # Daily spend limit for this agent
    per_request_cap: 0.50                 # Max cost per request
    fallback_model: "ollama/llama3.3:8b"  # Model to use when over budget
  rules:                                  # Agent-specific routing rules
    - condition: high_complexity
      model: anthropic/claude-sonnet-4-5
  sensitivity:
    keywords: ["custom-keyword"]          # Agent-specific sensitivity keywords
```

NOTE: Per-agent `rules` and budget fields are currently enforced at runtime. Per-agent `sensitivity` and `priority` are parsed but not yet runtime-enforced.

## Migrating from Single-Agent

A single-agent config:

```yaml
name: my-agent

models:
  cloud: "anthropic/claude-sonnet-4-5"
  local: "ollama/llama3.3:8b"
  credential_mode: env
  provider_keys:
    anthropic: "${ANTHROPIC_API_KEY}"

agents:
  - name: inbox-analyst
    role: inbox-analyst

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
```

Becomes a multi-agent config by adding more entries to `agents[]`:

```yaml
name: my-workforce

deployment:
  agent_runtime: openclaw

models:
  cloud: "anthropic/claude-sonnet-4-5"
  local: "ollama/llama3.3:8b"
  credential_mode: env
  provider_keys:
    anthropic: "${ANTHROPIC_API_KEY}"

agents:
  - name: inbox-analyst
    role: inbox-analyst
  - name: research-agent
    role: research-agent

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
```

Key differences:
- Add more entries to `agents[]` array
- `models` stays top-level (shared by all agents)
- `openclaw` uses named instances (e.g., `default`) with passthrough config
- Per-agent routing overrides go in each agent's `routing` block

## How It Works

### Workspace Layout

Single-agent:
```
workspace/
  AGENTS.md
  skills/inbox-analyst/SKILL.md
```

Multi-agent:
```
workspace/
  AGENTS.md                                    # Lists all agents
  inbox-analyst/skills/inbox-analyst/SKILL.md
  research-agent/skills/research-agent/SKILL.md
  ops-supervisor/skills/supervisor/SKILL.md
```

### OpenClaw Integration

Clawforce generates `openclaw.json` with:
- `agents.list` — Per-agent profiles with isolated workspaces
- Per-agent OpenClaw instance assignment via the `openclaw` named map
- Router plugin receives `agentBudgets` map for per-agent cost tracking

### Budget Isolation

Each agent has independent budget tracking via the BudgetTracker Map. Agent A spending $4 of its $5 budget does not affect Agent B's $10 budget.

## Validation Rules

- Config always uses the `agents[]` array (at least one agent required)
- Top-level `models.cloud` is required
- Agent names must be unique (lowercase alphanumeric + hyphens)
- Supervisor references must point to existing agents
- An agent cannot supervise itself
- `openclaw` must have at least one named instance
- When multiple openclaw instances are defined, each agent must specify which instance via `openclaw` field
