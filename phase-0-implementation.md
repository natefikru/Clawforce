# Phase 0: Implementation Guide

**Goal**: Deployable single-agent system with human-in-the-loop approval and compliance logging.
**Timeline**: 2 weeks
**Deliverable**: `clawforce deploy --config clawforce.yaml` -> working AI employee in 5 minutes.

---

## Architecture

```
clawforce deploy --config clawforce.yaml
         |
         v
  +------+------+
  | clawforce    |  Reads clawforce.yaml
  | CLI          |  Generates openclaw.json + docker-compose.yml
  +------+------+  Copies skills + hooks into workspace
         |
         v
  Docker Compose
  +------------------+     +------------------+
  | openclaw-gateway |     | ollama           |
  | (port 18789)     |<--->| (port 11434)     |
  | Node 22          |     | Llama 3.3 / etc  |
  +------------------+     +------------------+
         |
         +-- Slack (Socket Mode)
         +-- Approval Channel (#clawforce-approvals)
         +-- Compliance Log (./data/audit.jsonl)
```

---

## Part 1: Deployment Script

### 1.1 Config Format (`clawforce.yaml`)

The user-facing config. Simpler than raw `openclaw.json`.

```yaml
# clawforce.yaml
name: "acme-corp"

# Which agent role to deploy
role: "inbox-analyst"     # or "research-agent", "process-automator"

# Channels
slack:
  app_token: "xapp-1-..."
  bot_token: "xoxb-..."
  approval_channel: "C0123456789"   # Channel ID for human-in-the-loop approvals
  allowed_channels:
    - "C9876543210"                 # Channels the agent can participate in

# Models
models:
  primary: "anthropic/claude-sonnet-4-5"
  local: "ollama/llama3.3:8b"       # For routine/sensitive tasks
  api_key: "${ANTHROPIC_API_KEY}"    # Reads from env

# Approval mode
approval:
  mode: "hybrid"                     # "autonomous" | "human-in-the-loop" | "hybrid"
  require_approval_for:              # Only used in "hybrid" mode
    - "browser"                      # Browser actions need approval
    - "message.send"                 # Outbound messages need approval
    # "read", "write", "exec" can be added

# Data sensitivity
sensitivity:
  blocklist:                         # Terms that trigger local-only routing
    - "ssn"
    - "social security"
    - "credit card"
    - "password"
  pii_detection: true                # Auto-detect PII patterns

# Optional
ollama:
  enabled: true
  model: "llama3.3:8b"              # Auto-pulled on first deploy
```

### 1.2 Deploy Script (`clawforce`)

A Node.js CLI that reads `clawforce.yaml` and orchestrates deployment.

```
clawforce/
  bin/
    clawforce.mjs          # CLI entry point
  src/
    deploy.ts              # Main deploy logic
    config-generator.ts    # clawforce.yaml -> openclaw.json
    compose-generator.ts   # Generates docker-compose.yml
    workspace-setup.ts     # Copies skills + hooks into workspace
  templates/
    docker-compose.base.yml
    openclaw.base.json
    roles/
      inbox-analyst/
        SKILL.md
        config.partial.json
        cron-jobs.json
      research-agent/
        SKILL.md
        config.partial.json
      process-automator/
        SKILL.md
        config.partial.json
    hooks/
      approval-workflow/
        HOOK.md
        handler.ts
      compliance-logger/
        HOOK.md
        handler.ts
  data/                     # Mounted volume for audit logs
```

**Deploy flow**:
```bash
clawforce deploy --config clawforce.yaml

# 1. Parse clawforce.yaml
# 2. Generate openclaw.json (merge base + role config + channel config)
# 3. Generate docker-compose.yml (gateway + ollama if enabled)
# 4. Create workspace directory structure
# 5. Copy role SKILL.md into workspace/skills/
# 6. Copy hooks into workspace/hooks/
# 7. Pull Ollama model if enabled
# 8. docker compose up -d
# 9. Health check gateway
# 10. Print status + access info
```

### 1.3 Generated `openclaw.json`

What the config generator produces from the example `clawforce.yaml` above:

```json5
{
  // Agent config
  agents: {
    defaults: {
      workspace: "/home/node/.openclaw/workspace",
      model: {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: ["ollama/llama3.3:8b"],
      },
    },
  },

  // Slack channel
  channels: {
    slack: {
      enabled: true,
      mode: "socket",
      appToken: "xapp-1-...",
      botToken: "xoxb-...",
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      channels: {
        "C9876543210": { requireMention: true },
        "C0123456789": { requireMention: false },  // approval channel
      },
    },
  },

  // Cron (for inbox-analyst daily briefing)
  cron: {
    enabled: true,
  },

  // Hooks
  hooks: {
    enabled: true,
  },

  // Session config
  session: {
    dmScope: "per-channel-peer",
  },
}
```

### 1.4 Generated `docker-compose.yml`

```yaml
services:
  openclaw-gateway:
    image: openclaw/openclaw:latest
    container_name: clawforce-gateway
    restart: unless-stopped
    user: "1000:1000"
    ports:
      - "18789:18789"
    environment:
      - OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
      - OPENCLAW_GATEWAY_BIND=loopback
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - NODE_ENV=production
    volumes:
      - ./config:/home/node/.openclaw
      - ./workspace:/home/node/.openclaw/workspace
      - ./data:/home/node/.openclaw/data
    depends_on:
      ollama:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:18789/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  ollama:
    image: ollama/ollama:latest
    container_name: clawforce-ollama
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:11434/api/tags"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  ollama-data:
```

**Note**: For GPU passthrough (required for decent local model performance), add to the `ollama` service:
```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

On macOS (Metal), Ollama runs natively outside Docker -- the compose file would skip the ollama service and point to `host.docker.internal:11434`.

---

## Part 2: Agent Role Templates

### 2.1 Template Structure

Each role is a directory:
```
templates/roles/inbox-analyst/
  SKILL.md              # Agent behavior instructions
  config.partial.json   # Config fragment merged into openclaw.json
  cron-jobs.json        # Pre-configured cron jobs for this role
  README.md             # Human-readable setup guide
```

### 2.2 Inbox Analyst (`SKILL.md`)

```markdown
---
name: inbox-analyst
description: "Monitors Slack channels, summarizes activity, flags action items, and delivers daily briefings"
metadata:
  openclaw:
    emoji: "📬"
    requires:
      config: ["channels.slack"]
---

# Inbox Analyst

You are an Inbox Analyst AI employee deployed by Clawforce. Your role is to monitor
Slack channels, identify important messages, and keep your team informed.

## Core Responsibilities

1. **Channel Monitoring**: Watch all configured Slack channels for important messages.
2. **Action Item Detection**: Identify messages that contain requests, deadlines, questions,
   or decisions that need follow-up.
3. **Daily Briefing**: Every morning, compile a summary of overnight activity and deliver
   it to the configured channel.
4. **On-Demand Summary**: When asked "what did I miss?" or similar, provide a concise
   summary of recent activity.

## Behavior Rules

- **Be concise.** Summaries should be scannable, not walls of text.
- **Prioritize.** Lead with the most important items. Use categories:
  - 🔴 **Urgent**: Blockers, escalations, outages
  - 🟡 **Action Required**: Questions directed at team, pending decisions
  - 🔵 **FYI**: Updates, announcements, completed work
- **Attribute.** Always mention who said what ("@alice asked about the deployment timeline").
- **Don't hallucinate.** If you don't have enough context, say so.
- **Respect channels.** Only summarize channels you're configured to watch.

## Daily Briefing Format

```
📬 **Daily Briefing** — [Date]

🔴 **Urgent**
- [item]

🟡 **Action Required**
- [item]

🔵 **FYI**
- [item]

📊 **Activity**: X messages across Y channels
```

## Tools You Should Use

- `slack.read_recent` — Read recent messages from a channel
- `slack.react` — React to messages to acknowledge them
- `web_search` — Look up context if needed for summarization
- `cron` — Your daily briefing is scheduled via cron; deliver on schedule

## What NOT To Do

- Don't reply to messages on behalf of team members
- Don't take actions (send emails, create tickets) without approval
- Don't share information from one channel in another without being asked
- Don't summarize DMs unless explicitly configured
```

### 2.3 Inbox Analyst Cron Config (`cron-jobs.json`)

```json
[
  {
    "name": "daily-briefing",
    "cron": "0 8 * * 1-5",
    "tz": "America/New_York",
    "session": "isolated",
    "message": "Compile and deliver the daily briefing. Read recent messages from all monitored channels, identify key updates, and post the briefing summary.",
    "announce": true,
    "channel": "slack"
  }
]
```

### 2.4 Research Agent (`SKILL.md`)

```markdown
---
name: research-agent
description: "Takes research requests via Slack, browses the web, compiles reports, and delivers findings"
metadata:
  openclaw:
    emoji: "🔍"
    requires:
      config: ["channels.slack"]
      bins: ["chromium"]
---

# Research Agent

You are a Research Agent AI employee deployed by Clawforce. When team members ask
you to research a topic, you browse the web, gather information, and compile a
structured report.

## Core Responsibilities

1. **Accept Research Requests**: Listen for research questions in your configured channels.
2. **Web Research**: Use browser automation to visit relevant websites, read articles,
   and gather data.
3. **Report Compilation**: Synthesize findings into a clear, structured report.
4. **Source Attribution**: Always cite your sources with URLs.
5. **Approval Flow**: For outbound reports, post a draft to the approval channel first.

## Research Process

1. Acknowledge the request ("Researching [topic], I'll have a report shortly.")
2. Plan your research approach (what to search, which sites to visit)
3. Execute web searches and browse relevant pages
4. Take notes on key findings
5. Compile into structured report
6. Post draft to approval channel (if approval mode is enabled)
7. Once approved, deliver to the requesting channel

## Report Format

```
🔍 **Research Report**: [Topic]
**Requested by**: @[user] | **Date**: [date]

## Summary
[2-3 sentence executive summary]

## Key Findings
1. **[Finding]**: [Detail with source]
2. **[Finding]**: [Detail with source]

## Data Points
- [Metric/fact with source]
- [Metric/fact with source]

## Sources
- [Title](URL)
- [Title](URL)

## Limitations
[What you couldn't find or verify]
```

## Tools You Should Use

- `browser.navigate` — Visit web pages
- `browser.snapshot` — Capture page content
- `web_search` — Search the web (Brave Search)
- `slack.send` — Deliver reports
- `read` / `write` — Save intermediate research notes

## What NOT To Do

- Don't present speculation as fact
- Don't skip source attribution
- Don't send reports without approval (when approval mode is on)
- Don't access internal company systems for research (use the browser for public web only)
```

### 2.5 Process Automator (`SKILL.md`)

```markdown
---
name: process-automator
description: "Executes browser-based workflows on schedule or trigger, automates repetitive web tasks"
metadata:
  openclaw:
    emoji: "⚙️"
    requires:
      config: ["channels.slack"]
      bins: ["chromium"]
---

# Process Automator

You are a Process Automator AI employee deployed by Clawforce. You execute
browser-based workflows on a schedule or when triggered, automating repetitive
tasks that involve web interfaces.

## Core Responsibilities

1. **Scheduled Tasks**: Execute pre-configured workflows on cron schedules.
2. **Triggered Tasks**: Respond to webhook or Slack triggers to run workflows.
3. **Browser Automation**: Navigate web interfaces, fill forms, extract data, click buttons.
4. **Status Reporting**: Report task completion/failure to the configured Slack channel.
5. **Error Handling**: When a workflow fails, capture a screenshot, log the error, and alert.

## Workflow Execution

1. Receive trigger (cron, webhook, or Slack message)
2. Load workflow instructions from the request
3. Open browser and navigate to target
4. Execute steps (login, navigate, extract, submit)
5. Capture results (screenshots, extracted data)
6. Post results to Slack
7. Log all actions for audit trail

## Status Report Format

```
⚙️ **Task Complete**: [Workflow Name]
**Status**: ✅ Success / ❌ Failed
**Duration**: [time]
**Actions taken**: [count]
**Results**: [summary or extracted data]
```

## Tools You Should Use

- `browser.navigate` — Visit web pages
- `browser.click` / `browser.type` / `browser.select` — Interact with forms
- `browser.snapshot` — Capture page state
- `cron` — Scheduled execution
- `slack.send` — Report results

## What NOT To Do

- Don't store credentials in chat -- use environment variables
- Don't proceed past errors silently -- always report failures
- Don't run workflows that modify financial data without approval
- Don't skip the audit log
```

---

## Part 3: Human-in-the-Loop Approval Hook

### 3.1 How It Works

```
Agent wants to execute a tool (e.g., browser.navigate, message.send)
         |
         v
  Approval hook intercepts (PostToolUse event)
         |
         +-- Tool NOT in require_approval_for list? -> Proceed normally
         |
         +-- Tool IS in require_approval_for list?
                  |
                  v
            Post to Slack approval channel:
            "🔔 Agent wants to [action]. Approve? React ✅ or ❌"
                  |
                  +-- ✅ reacted -> Proceed with tool execution
                  +-- ❌ reacted -> Abort, log rejection
                  +-- Timeout (5 min) -> Abort, log timeout
```

### 3.2 Approval Hook (`HOOK.md`)

```markdown
---
name: approval-workflow
description: "Human-in-the-loop approval for sensitive agent actions"
metadata:
  openclaw:
    emoji: "🔔"
    events: ["agent:bootstrap"]
---

# Approval Workflow Hook

Intercepts agent actions that require human approval before execution.
Posts approval requests to a dedicated Slack channel and waits for a reaction.
```

### 3.3 Implementation Approach

The approval workflow can be implemented via the **agent's SKILL.md instructions** rather than a code-level hook. This is simpler for MVP and uses OpenClaw's existing capabilities:

**In the SKILL.md for each role, add this section:**

```markdown
## Approval Workflow

You operate in **hybrid approval mode**. Before executing any of the following
actions, you MUST post a draft to the approval channel and wait for confirmation:

- Sending messages to external channels (outside your monitored channels)
- Browser actions that submit forms or click buttons (read-only browsing is OK)
- Creating, editing, or deleting files
- Running shell commands

### Approval Process

1. When you need to take an action that requires approval:
   - Post to the approval channel: `#clawforce-approvals`
   - Format:
     ```
     🔔 **Approval Request**
     **Agent**: [your role name]
     **Action**: [what you want to do]
     **Context**: [why]
     **Details**: [specific parameters]

     React ✅ to approve or ❌ to reject.
     ```
2. Wait for a reaction on your message.
3. If ✅: proceed with the action and confirm completion.
4. If ❌: acknowledge the rejection and do NOT proceed.
5. If no response within 5 minutes: do NOT proceed, log as timeout.

### Actions That Do NOT Need Approval

- Reading Slack messages
- Web browsing (read-only, no form submissions)
- Web searches
- Generating reports (drafts -- not sending them)
- Responding in your monitored channels
```

**Why this approach for MVP**: OpenClaw agents already follow SKILL.md instructions faithfully. Teaching the agent to self-gate via its prompt is faster than building a code-level interceptor hook. For Phase 1+, we can add a proper code hook for enforcement.

---

## Part 4: Compliance Logger Hook

### 4.1 Hook Structure

```
workspace/hooks/compliance-logger/
  HOOK.md
  handler.ts
```

### 4.2 `HOOK.md`

```markdown
---
name: compliance-logger
description: "Logs all agent actions to an append-only audit trail"
metadata:
  openclaw:
    emoji: "📋"
    events: ["command:new", "command:reset"]
---

# Compliance Logger

Captures all agent commands and session events to a JSONL audit file.
```

### 4.3 `handler.ts`

OpenClaw's bundled `command-logger` hook already logs commands to JSONL. For MVP, we can:

1. **Enable the built-in `command-logger` hook** (already exists in OpenClaw at `src/hooks/bundled/command-logger/`)
2. **Configure it to write to our audit volume**

In the generated `openclaw.json`, ensure hooks are enabled:
```json5
{
  hooks: {
    enabled: true,
    // The bundled command-logger writes to ~/.openclaw/logs/commands.log
    // We mount this to our persistent audit volume
  },
}
```

For richer audit logging (tool-level detail), the approach for MVP is:

**Add to every SKILL.md**:
```markdown
## Audit Logging

For EVERY action you take, append a one-line JSON log entry to `/home/node/.openclaw/data/audit.jsonl`:

```json
{"ts":"2026-02-14T15:30:00Z","agent":"inbox-analyst","action":"slack.read_recent","target":"C123","result":"success","tokens":{"in":150,"out":200},"model":"ollama/llama3.3:8b"}
```

Log these events:
- Every tool call (tool name, target, success/failure)
- Every message sent (channel, recipient)
- Every approval request (action, outcome)
- Every model call (which model, token count)
```

**Why prompt-based for MVP**: Gets us audit logging immediately without writing TypeScript hooks. The agent writes structured JSONL that's parseable by the dashboard later. For Phase 1+, a proper hook provides enforcement.

---

## Part 5: Workspace Directory Structure

What the deploy script creates:

```
./clawforce-deployment/
  clawforce.yaml                    # User config (input)
  docker-compose.yml                # Generated
  .env                              # Generated (secrets)
  config/
    openclaw.json                   # Generated from clawforce.yaml
  workspace/
    AGENTS.md                       # Agent identity + rules
    skills/
      inbox-analyst/
        SKILL.md                    # Role template
      approval-workflow/
        SKILL.md                    # Approval instructions (injected into all roles)
    hooks/
      (bundled hooks auto-loaded)
  data/
    audit.jsonl                     # Compliance log (append-only)
    cron/
      jobs.json                     # Cron job definitions
```

### 5.1 `AGENTS.md` (Agent Identity)

```markdown
# Clawforce AI Employee

You are an AI employee deployed by Clawforce for {{company_name}}.
You work alongside the human team via Slack.

## Rules

1. You follow the approval workflow for sensitive actions.
2. You log all actions to the audit trail.
3. You never share information between channels unless explicitly asked.
4. You never store or repeat credentials, passwords, or API keys.
5. You are concise and professional.
6. When uncertain, ask for clarification rather than guessing.

## Your Role

You are the **{{role_name}}**. See your role-specific SKILL.md for detailed instructions.
```

---

## Part 6: Deploy Script Implementation

### 6.1 `package.json`

```json
{
  "name": "clawforce",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "clawforce": "./bin/clawforce.mjs"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "yaml": "^2.4.0",
    "chalk": "^5.3.0"
  }
}
```

### 6.2 CLI Commands

```bash
# Deploy a new instance
clawforce deploy --config clawforce.yaml

# Check status
clawforce status

# View audit log
clawforce audit --tail 50

# Stop the deployment
clawforce stop

# Update agent role
clawforce role set research-agent

# View cost summary (reads from audit.jsonl)
clawforce cost --period today
```

### 6.3 Deploy Logic (Pseudocode)

```typescript
async function deploy(configPath: string) {
  // 1. Read and validate clawforce.yaml
  const config = parseYaml(readFile(configPath));
  validate(config);

  // 2. Create deployment directory
  const deployDir = `./clawforce-${config.name}`;
  mkdirSync(deployDir, { recursive: true });

  // 3. Generate openclaw.json
  const openclawConfig = generateOpenClawConfig(config);
  writeJson(`${deployDir}/config/openclaw.json`, openclawConfig);

  // 4. Generate docker-compose.yml
  const compose = generateCompose(config);
  writeYaml(`${deployDir}/docker-compose.yml`, compose);

  // 5. Generate .env
  const env = generateEnv(config);
  writeFile(`${deployDir}/.env`, env);

  // 6. Setup workspace
  copyRoleTemplate(config.role, `${deployDir}/workspace/skills/`);
  writeAgentsMd(config, `${deployDir}/workspace/AGENTS.md`);

  // 7. Setup cron jobs (if role has them)
  const cronJobs = loadCronJobs(config.role);
  if (cronJobs.length > 0) {
    writeJson(`${deployDir}/data/cron/jobs.json`, cronJobs);
  }

  // 8. Pull Ollama model (if enabled)
  if (config.ollama?.enabled) {
    await exec(`docker compose -f ${deployDir}/docker-compose.yml up -d ollama`);
    await exec(`docker exec clawforce-ollama ollama pull ${config.ollama.model}`);
  }

  // 9. Start gateway
  await exec(`docker compose -f ${deployDir}/docker-compose.yml up -d`);

  // 10. Health check
  await waitForHealthy("http://127.0.0.1:18789/health", 30_000);

  console.log("Clawforce deployed successfully!");
  console.log(`Gateway: http://127.0.0.1:18789`);
  console.log(`Role: ${config.role}`);
  console.log(`Approval channel: ${config.slack.approval_channel}`);
}
```

---

## Part 7: Testing the MVP

### 7.1 Smoke Test Checklist

After `clawforce deploy`:

- [ ] Gateway is running (`curl http://127.0.0.1:18789/health`)
- [ ] Ollama is running (`curl http://127.0.0.1:11434/api/tags`)
- [ ] Slack bot is online (check Slack workspace)
- [ ] Send a message in a monitored channel -- agent responds
- [ ] Ask agent to research something -- it uses the browser
- [ ] Agent posts approval request to approval channel
- [ ] React with ✅ -- agent proceeds
- [ ] React with ❌ -- agent aborts
- [ ] Check `data/audit.jsonl` -- actions are logged
- [ ] Cron job fires at scheduled time (or trigger manually)
- [ ] Daily briefing is delivered to channel

### 7.2 Dogfood Plan (Week 2)

Connect to your own Slack workspace:
1. Deploy Inbox Analyst role
2. Add 2-3 channels to monitor
3. Use it daily for a week
4. Note: what works, what breaks, what's missing
5. Record a demo video for investor meetings

---

## Implementation Plan (Development Pipeline)

Each implementation unit follows: **Write code -> Write/update tests -> Run tests -> Commit -> Push**.

### Unit 1: Project Scaffolding + CLI Skeleton
**Files**: `package.json`, `tsconfig.json`, `bin/clawforce.mjs`, `src/cli.ts`
**Tests**: CLI parses `--config` flag, prints help, exits cleanly on missing config
**Commit**: `feat: scaffold clawforce CLI with commander`

### Unit 2: Config Parser + Validator
**Files**: `src/config/parse.ts`, `src/config/schema.ts`, `src/config/parse.test.ts`
**Tests**: Parses valid clawforce.yaml, rejects invalid configs, resolves env vars
**Commit**: `feat: add clawforce.yaml parser and validation`

### Unit 3: OpenClaw Config Generator
**Files**: `src/config/generate-openclaw.ts`, `src/config/generate-openclaw.test.ts`
**Tests**: Generates valid openclaw.json from clawforce.yaml, merges role partials, handles Slack + model + cron config
**Commit**: `feat: generate openclaw.json from clawforce config`

### Unit 4: Docker Compose Generator
**Files**: `src/config/generate-compose.ts`, `src/config/generate-compose.test.ts`, `src/config/generate-env.ts`
**Tests**: Generates compose with gateway + ollama, skips ollama when disabled, generates .env with secrets
**Commit**: `feat: generate docker-compose.yml and .env`

### Unit 5: Agent Role Templates (Inbox Analyst)
**Files**: `templates/roles/inbox-analyst/SKILL.md`, `templates/roles/inbox-analyst/config.partial.json`, `templates/roles/inbox-analyst/cron-jobs.json`
**Tests**: Template files exist and contain required YAML frontmatter, config partial merges cleanly
**Commit**: `feat: add inbox-analyst role template`

### Unit 6: Agent Role Templates (Research Agent + Process Automator)
**Files**: `templates/roles/research-agent/SKILL.md`, `templates/roles/process-automator/SKILL.md`, corresponding config partials
**Tests**: Template files exist, YAML frontmatter valid, config partials merge cleanly
**Commit**: `feat: add research-agent and process-automator templates`

### Unit 7: Workspace Setup + AGENTS.md Generation
**Files**: `src/workspace/setup.ts`, `src/workspace/setup.test.ts`, `templates/AGENTS.md.tmpl`
**Tests**: Creates workspace dir structure, copies skills, generates AGENTS.md with company name/role
**Commit**: `feat: workspace directory setup and AGENTS.md generation`

### Unit 8: Deploy Command (Orchestration)
**Files**: `src/commands/deploy.ts`, `src/commands/deploy.test.ts`
**Tests**: Full deploy flow with mocked docker/exec, health check retry logic, error handling
**Commit**: `feat: implement deploy command with docker compose orchestration`

### Unit 9: Status + Stop + Audit Commands
**Files**: `src/commands/status.ts`, `src/commands/stop.ts`, `src/commands/audit.ts`
**Tests**: Status reads container state, stop calls compose down, audit tails JSONL
**Commit**: `feat: add status, stop, and audit CLI commands`

### Unit 10: Integration Test + Smoke Test
**Files**: `test/integration/deploy.test.ts`, `test/smoke-checklist.md`
**Tests**: Full deploy -> health check -> stop cycle (requires Docker), smoke test checklist documented
**Commit**: `test: add integration test for deploy lifecycle`

---

## Open Questions (Resolve Before Building)

1. **Ollama on macOS**: Docker Ollama can't access Metal GPU. Run Ollama natively on Mac and point gateway to `host.docker.internal:11434`? Or run everything natively (no Docker) for Mac dev?
2. **Slack app distribution**: For pilot customers, do we create one Slack app per customer or use Slack's app distribution? (Answer: one per customer for MVP -- simpler, more secure.)
3. **Approval timeout**: 5 minutes reasonable? Should it be configurable?
4. **Audit log rotation**: For MVP, single file is fine. When does it need rotation/shipping?
5. **Multi-model routing**: Phase 0 uses OpenClaw's built-in fallback chain. The smart sensitivity-based router is Phase 1. Is the fallback chain sufficient for demos?

---

## Not In Scope (Phase 0)

- Model routing by sensitivity (Phase 1)
- ROI dashboard / web UI (Phase 1)
- Three-layer accuracy tracking (Phase 1)
- Self-learning feedback loop (Phase 2)
- Multi-agent management (Phase 2)
- Visual flow builder (Phase 4)
- Billing engine (Phase 3)
- SOC 2 certification (Phase 3)
