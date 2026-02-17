# Multi-Agent Configuration

Clawforce supports deploying multiple specialized AI agents from a single config file. Each agent has its own role, channel assignments, routing rules, and budget — managed through one gateway.

## Overview

Multi-agent mode replaces the single `role` field with an `agents[]` array and a `defaults` block. The gateway remains a single process; OpenClaw handles per-agent routing via bindings.

**Key concepts:**
- **`defaults`** — Shared model config, router settings, and dashboard config inherited by all agents
- **`agents[]`** — Per-agent role, channels, and routing overrides
- **`bindings`** — Auto-generated channel-to-agent mappings (you define channels, Clawforce builds bindings)

## Example Config

```yaml
name: my-workforce

defaults:
  models:
    cloud: "anthropic/claude-sonnet-4-5"
    local: "ollama/llama3.3:8b"
    credential_mode: env
    provider_keys:
      anthropic: "${ANTHROPIC_API_KEY}"
  router:
    priority: [policy, sensitivity, cost, domain, complexity]
    sensitivity_keywords: [password, secret]
  dashboard:
    enabled: true
    auth:
      enabled: false

agents:
  - name: inbox-analyst
    role: inbox-analyst
    channels:
      - type: channel
        channels: ["1234567890123456789", "1234567890123456790"]  # Discord channel IDs
    routing:
      budget_daily: 5.00

  - name: research-agent
    role: research-agent
    channels:
      - type: channel
        channels: ["1234567890123456791"]  # Discord channel ID
      - type: dm
        users: ["9876543210987654321", "9876543210987654322"]  # Discord user IDs
    routing:
      budget_daily: 10.00
      rules:
        - condition: high_complexity
          model: anthropic/claude-sonnet-4-5

  - name: ops-supervisor
    role: supervisor
    channels:
      - type: channel
        channels: ["1234567890123456792"]  # Discord channel ID
    supervises: [inbox-analyst, research-agent]
    routing:
      budget_daily: 3.00

openclaw:
  channels:
    discord:
      enabled: true
      token: "${DISCORD_BOT_TOKEN}"
```

## Schema Reference

### `defaults`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `models.cloud` | string | Yes | Default cloud model for all agents |
| `models.local` | string | No | Default local/fallback model |
| `models.credential_mode` | `env` \| `auth_profile` | No | How API keys are resolved (default: `env`) |
| `models.provider_keys` | map | No | Provider API keys (required when `credential_mode=env` and cloud model used) |
| `models.auth_profile` | string | No | OpenClaw auth profile name (required when `credential_mode=auth_profile`) |
| `router` | object | No | Default router configuration (same schema as top-level `router`) |
| `dashboard` | object | No | Dashboard configuration (same schema as top-level `dashboard`) |

### `agents[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent identifier (lowercase alphanumeric + hyphens, max 50 chars) |
| `role` | enum | Yes | `inbox-analyst`, `research-agent`, `process-automator`, or `supervisor` |
| `channels` | array | No | Channel assignments (see below) |
| `routing` | object | No | Per-agent routing overrides |
| `skills` | array | No | Additional skill IDs |
| `supervises` | array | No | Names of agents this agent supervises |

### Channel Assignments

Channel assignments use **platform-specific IDs**, not human-readable names. For Discord, use channel IDs and user IDs (numeric snowflakes).

> **Getting Discord IDs:** Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode), then right-click any channel or user and select "Copy Channel ID" or "Copy User ID".

```yaml
channels:
  - type: channel            # Route messages from specific channels
    channels: ["1234567890123456789"]  # Discord channel ID
  - type: dm                 # Route direct messages from specific users
    users: ["9876543210987654321", "9876543210987654322"]  # Discord user IDs
```

### Per-Agent Routing

```yaml
routing:
  budget_daily: 5.00                    # Daily spend limit for this agent
  per_request_cap: 0.50                 # Max cost per request
  fallback_model: "ollama/llama3.3:8b"  # Model to use when over budget
  rules:                                # Agent-specific routing rules
    - condition: high_complexity
      model: anthropic/claude-sonnet-4-5
  sensitivity_keywords: ["internal"]    # Additional PII keywords
  priority: [sensitivity, cost]         # Dimension evaluation order
```

## Migrating from Single-Agent

A single-agent config:

```yaml
name: my-agent
role: inbox-analyst
models:
  primary: "anthropic/claude-sonnet-4-5"
  local: "ollama/llama3.3:8b"
  credential_mode: env
  provider_keys:
    anthropic: "${ANTHROPIC_API_KEY}"
```

Becomes a multi-agent config:

```yaml
name: my-workforce
defaults:
  models:
    cloud: "anthropic/claude-sonnet-4-5"     # was models.primary
    local: "ollama/llama3.3:8b"              # was models.local
    credential_mode: env
    provider_keys:
      anthropic: "${ANTHROPIC_API_KEY}"

agents:
  - name: inbox-analyst
    role: inbox-analyst
    channels:
      - type: channel
        channels: ["1234567890123456789"]  # Discord channel ID
```

Key differences:
- `role` moves into each agent entry
- `models.primary` becomes `defaults.models.cloud`
- `models.local` becomes `defaults.models.local`
- Provider keys move to `defaults.models.provider_keys`
- `openclaw.channels` is still required for the connector (e.g., Discord)

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
- `bindings` — Channel-to-agent routing from your `channels` config
- Router plugin receives `agentBudgets` map for per-agent cost tracking

### Budget Isolation

Each agent has independent budget tracking via the BudgetTracker Map. Agent A spending $4 of its $5 budget does not affect Agent B's $10 budget.

## Validation Rules

- Config must use **either** `role` (single-agent) **or** `agents` (multi-agent), not both
- Multi-agent requires `defaults.models.cloud`
- Agent names must be unique (lowercase alphanumeric + hyphens)
- Supervisor references must point to existing agents
- An agent cannot supervise itself
- At least one agent must have channels, or `openclaw.channels` must be set
- Channel type `channel` requires `channels` array; type `dm` requires `users` array
