# Multi-Agent Configuration

Clawforce supports deploying multiple specialized AI agents from a single config file. Each agent has its own workspace, routing overrides, and budget — managed through one gateway.

## Overview

Multi-agent configs use a top-level `agents[]` array alongside shared `models`, `routing`, and `dashboard` config. The gateway remains a single process; OpenClaw handles per-agent routing via named instance bindings.

**Key concepts:**
- **`models`** — Named list of routing targets (only needed if routing rules reference models)
- **`agents[]`** — Per-agent workspace, openclaw instance reference, runtime, and routing overrides
- **`openclaw`** — Named map of OpenClaw instances with passthrough config (owns the default model)

## Example Config

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
    workspace: ./workspaces/inbox-analyst
    routing:
      budget:
        daily_limit: 5.00

  - name: research-agent
    workspace: ./workspaces/research-agent
    routing:
      budget:
        daily_limit: 10.00
      rules:
        - condition: high_complexity
          model: "claude"

  - name: ops-supervisor
    workspace: ./workspaces/ops-supervisor
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
```

## Schema Reference

### `models` (top-level, shared by all agents)

The `models` list is only needed when routing rules reference specific models by name. Each entry defines a named routing target.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique model name (referenced in routing rules) |
| `id` | string | Yes | Model identifier in `provider/model-name` format |
| `type` | `local` \| `cloud` | Yes | Whether this model is local (PII-safe) or cloud |
| `api_key` | string | No | API key for cloud models (supports `${ENV_VAR}` expansion) |
| `engine` | object | No | Engine config for local models (runtime, location, gpu, port, etc.) |

### `auth_profile` (top-level, optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `auth_profile` | string | No | OpenClaw auth profile name (replaces old `credential_mode: auth_profile`) |

### `agents[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent identifier (lowercase alphanumeric + hyphens, max 50 chars) |
| `workspace` | string | Yes | Path to the agent's OpenClaw workspace directory (relative to config file, or absolute) |
| `openclaw` | string | No | OpenClaw instance name (required when multiple openclaw instances are defined) |
| `runtime` | string | No | Agent orchestration runtime (defaults to `"openclaw"`) |
| `routing` | object | No | Per-agent routing overrides |
| `supervises` | array | No | Names of agents this agent supervises (presence makes it a supervisor) |

### Per-Agent Routing

```yaml
routing:
  budget:
    daily_limit: 5.00                     # Daily spend limit for this agent
    per_request_cap: 0.50                 # Max cost per request
    fallback_model: "llama"               # References model by name
  rules:                                  # Agent-specific routing rules
    - condition: high_complexity
      model: "claude"                     # References model by name
  sensitivity:
    keywords: ["custom-keyword"]          # Agent-specific sensitivity keywords
```

NOTE: Per-agent `rules` and budget fields are currently enforced at runtime. Per-agent `sensitivity` and `priority` are parsed but not yet runtime-enforced.

## Migrating from Single-Agent

A single-agent config:

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
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"

agents:
  - name: inbox-analyst
    workspace: ./workspaces/inbox-analyst

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
  - name: inbox-analyst
    workspace: ./workspaces/inbox-analyst
  - name: research-agent
    workspace: ./workspaces/research-agent

openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
```

Key differences:
- Add more entries to `agents[]` array
- `models` stays top-level (shared by all agents, only needed for routing targets)
- `openclaw` uses named instances (e.g., `default`) with passthrough config
- Per-agent routing overrides go in each agent's `routing` block

## How It Works

### Workspace Layout

Each agent's `workspace` field points to a user-managed directory. Docker Compose mounts each agent's workspace individually into the container.

Single-agent:
```
workspaces/
  my-agent/
    SOUL.md
    SKILL.md
    skills/
```

Multi-agent:
```
workspaces/
  inbox-analyst/
    SOUL.md
    SKILL.md
    skills/
  research-agent/
    SOUL.md
    SKILL.md
    skills/
  ops-supervisor/
    SOUL.md
    SKILL.md
    skills/
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
- `models` list is optional -- only needed when routing rules reference models by name
- Routing rule model references are validated at parse time against the `models` list
- Agent names must be unique (lowercase alphanumeric + hyphens)
- Supervisor references must point to existing agents
- An agent cannot supervise itself
- `openclaw` must have at least one named instance
- When multiple openclaw instances are defined, each agent must specify which instance via `openclaw` field
