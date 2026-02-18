# Clawforce: Forward Roadmap

**Date**: 2026-02-16
**Starting Point**: Post-2A (all production readiness complete), pre-2B hardening gates passed
**Built On**: OpenClaw (open-source multi-channel AI gateway)
**Test Count**: 878 passing (59 test files, 80% coverage enforced)

---

## Shipped (Phases 0, 1, 2A)

All foundational and production-readiness work is complete:

| Component | Tests | Status |
|-----------|-------|--------|
| CLI (deploy, status, stop, audit, route-test, migrate, user, plugins-watch) | ~700 | Complete |
| 5-Dimension Model Router (PII, complexity, domain, budget, data policy) | ~200 | Complete |
| PII Detection (11 types + adversarial defense + output filtering) | ~120 | Complete |
| Compliance Logger (JSONL + SQLite dual-write, 5 framework profiles) | ~60 | Complete |
| Budget Tracking (daily limits, per-agent SQLite state, conservative fallback) | ~38 | Complete |
| SQLite Storage Layer (7 tables, dual-write, migrations, WAL mode) | ~87 | Complete |
| Dashboard Auth (Auth.js v5, RBAC, JWT sessions, user management) | ~112 | Complete |
| Real-Time Event Streaming (multiplexed SSE, cursor-based reconnection) | ~45 | Complete |
| Model Health Monitoring (circuit breaker, failover-safe/block policies) | ~20 | Complete |
| Alert System (budget/PII/health/error/idle alerts, email, SSE) | ~20 | Complete |
| Plugin TypeScript Compilation (esbuild, source maps, watch mode) | ~10 | Complete |
| Docker Compose Generation (gateway + Ollama/SGLang/vLLM + dashboard) | ~30 | Complete |
| 3 Role Templates (inbox-analyst, research-agent, process-automator) | ~10 | Complete |
| Config System (clawforce.yaml -> openclaw.json, Zod validation) | ~30 | Complete |
| Multi-instance monitor support (Map-based, not singletons) | Updated | Complete |
| Conservative fallback pricing (unknown models don't bypass budget) | 15 | Complete |

**Pre-2B Hardening Gates** (all passed):
- Gateway bind defaults to loopback with explicit LAN opt-in
- Dashboard auth policy must be explicit when dashboard is enabled
- Deploy flow runs OpenClaw security audit and blocks on critical findings
- Router budget tracking supports per-agent state in SQLite
- Compliance storage/read paths normalize and filter by agent scope
- Credential strategy supports `env` and `auth_profile` modes
- Monitor singletons replaced with Map for multi-agent coexistence
- Unknown cloud models use conservative fallback pricing ($15/$75 per M tokens)

---

## Strategic Direction

### Product Thesis

Clawforce deploys **coordinated AI workforces** (not individual agents) into enterprise infrastructure. The differentiation is:

- **Ultron pattern**: A supervisory agent that manages, monitors, and reports on sub-agents
- **Data sovereignty**: PII never leaves the network, enforced at the routing layer (3 independent layers)
- **Cost intelligence**: 60-80% savings through local model routing with safety invariants
- **Compliance by default**: Audit trail, framework profiles (HIPAA/PCI-DSS/GDPR/CCPA/SOX), output filtering

The pitch shifts from "deploy an AI employee" to "deploy an AI department."

---

## Phase 2B: Multi-Agent Orchestration — The Ultron Pattern

**Goal**: Deploy and manage multiple coordinated AI agents from a single Clawforce instance
**Duration**: ~4 weeks
**Cost**: ~$500 (API testing)

### Key Architectural Decision: Single Gateway vs. Multiple Gateways

OpenClaw supports multi-agent natively within a single gateway via its **8-tier priority binding** system (`agents.bindings` in config). Each agent gets its own workspace, session namespace, and model config. The `before_agent_start` hook receives `ctx.agentId`, enabling per-agent routing decisions.

**Recommended approach: Single gateway, multiple agents.** This is simpler, lower resource usage, and aligns with how OpenClaw is designed. Per-agent Docker sandbox isolation is still available via OpenClaw's `sandbox` config per agent.

The alternative (one gateway container per agent) adds complexity for port allocation, cross-container communication, and compose generation — with no clear benefit since OpenClaw already isolates agents internally.

---

### 2B.1 Multi-Agent Configuration Schema ✅

**Status**: Complete. See [docs/MULTI-AGENT.md](docs/MULTI-AGENT.md) for the full reference.

**Goal**: Extend `clawforce.yaml` to define multiple agents with distinct roles, channels, routing rules, and budgets.

**Key Files to Modify**:
- `src/config/types.ts` — Zod schema: add `AgentSchema` and `agents[]` array
- `src/config/parse.ts` — Config parsing: validate multi-agent config
- `src/config/generate-openclaw.ts` — Generate `openclaw.json` with all agents registered
- `src/config/generate-compose.ts` — Adjust compose for multi-agent (likely minimal changes with single-gateway approach)
- `src/config/generate-env.ts` — Per-agent env vars if needed

**Design**:

```yaml
# clawforce.yaml — multi-agent config
name: acme-ai-workforce

models:
  - name: qwen
    id: "sglang/qwen3-32b"
    type: local
    engine:
      runtime: sglang
      location: container
      model: qwen3-32b
      gpu: nvidia
  - name: claude
    id: "anthropic/claude-sonnet-4-5"
    type: cloud
    api_key: "${ANTHROPIC_API_KEY}"

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
        daily_limit: 8.00
      rules:
        - condition: domain_research
          model: "claude"

  - name: ultron
    role: supervisor
    supervises: [inbox-analyst, research-agent]
    routing:
      budget:
        daily_limit: 3.00

routing:
  priority: [policy, sensitivity, cost, domain, complexity]
  sensitivity:
    keywords: [confidential, restricted]

dashboard:
  enabled: true
  auth:
    enabled: true
    username: admin
    password: "${DASHBOARD_PASSWORD}"

# Named OpenClaw instances — passthrough config merged last
openclaw:
  default:
    channels:
      discord:
        enabled: true
        token: "${DISCORD_BOT_TOKEN}"
    agents:
      defaults:
        tools:
          sandbox:
            enabled: true
```

**Schema Changes** (`src/config/types.ts`):

1. Extract a new `AgentConfigSchema` from the existing top-level fields:
   ```typescript
   const AgentConfigSchema = z.object({
     name: z.string().min(1),
     role: z.enum(["inbox-analyst", "research-agent", "process-automator", "supervisor"]),
     channels: z.array(ChannelSchema).optional(),
     routing: RoutingConfigSchema.optional(),
     skills: z.array(z.string()).optional(),
     supervises: z.array(z.string()).optional(),
     sandbox: z.object({ mode: z.enum(["off", "non-main", "all"]) }).optional(),
   });
   ```

2. Add `agents` to the top-level schema alongside the existing `role` field (backward compatible):
   ```typescript
   // Either single-agent (role: ...) or multi-agent (agents: [...])
   // Both are valid; role is shorthand for agents: [{ name: <name>, role: <role> }]
   ```

3. Add `.superRefine()` cross-validation:
   - `agents[].supervises` references must point to other agent names
   - Budget sum across agents should not exceed a configurable total (optional)
   - Channel assignments must not overlap between agents (warn, don't block)

**OpenClaw Config Generation** (`src/config/generate-openclaw.ts`):

The generated `openclaw.json` will use OpenClaw's native multi-agent config:
```json
{
  "agents": {
    "list": [
      { "id": "inbox-analyst", "workspace": "./workspace/inbox-analyst", ... },
      { "id": "research-agent", "workspace": "./workspace/research-agent", ... },
      { "id": "ultron", "workspace": "./workspace/ultron", ... }
    ],
    "defaults": { "model": { ... }, "tools": { ... } }
  },
  "bindings": [
    { "agentId": "inbox-analyst", "match": { "channel": "channel", "peer": "#inbox-triage" } },
    { "agentId": "research-agent", "match": { "channel": "channel", "peer": "#research-requests" } },
    { "agentId": "ultron", "match": { "channel": "channel", "peer": "#ai-ops" } }
  ]
}
```

**BudgetTracker Refactoring**:

Current: `this.state` holds one agent's state, `useAgent()` swaps on context change (race condition for concurrent agents).

Fix: Replace `this.state` with `Map<string, BudgetState>` so concurrent agents don't thrash:

```typescript
// src/plugins/clawforce-router/budget-tracker.ts
private readonly states = new Map<string, BudgetState>();

private getAgentState(agentId?: string): BudgetState {
  const id = normalizeAgentId(agentId);
  let state = this.states.get(id);
  if (!state) {
    state = this.loadState(id);
    this.states.set(id, state);
  }
  return state;
}
```

**Tests**:
- Multi-agent config parsing with validation
- Config with `agents[]` generates correct openclaw.json with bindings
- Config with single `role` still works (backward compatibility)
- Per-agent budget isolation
- Supervisor `supervises` validation
- Channel overlap warning

---

### 2B.2 Supervisor Agent Template (Ultron) ✅

**Status**: Complete.

**Goal**: Create a new role template that monitors sub-agents and reports on workforce activity.

**Key Files to Create**:
- `templates/roles/supervisor/SKILL.md` — Agent behavior instructions
- `templates/roles/supervisor/config.partial.json` — OpenClaw config fragment
- `templates/roles/supervisor/README.md` — Setup guide

**SKILL.md Design**:

The supervisor agent's skill instructions should include:
- **Monitoring**: Query compliance logs for sub-agent activity, errors, and anomalies
- **Reporting**: Generate daily/weekly summaries of all agent activity (tasks completed, tokens used, cost, errors)
- **Escalation**: Flag failures, budget exhaustion, PII violations, or idle agents to human operators
- **Redistribution**: Suggest or initiate work redistribution when an agent is overloaded or down
- **Status queries**: Answer "what is the AI workforce doing right now?" from the ops channel

**Implementation approach**: The supervisor is a regular OpenClaw agent with access to Clawforce's SQLite database via a custom tool. Rather than building a separate orchestration layer, we give the supervisor agent a `clawforce-status` tool that queries `StorageReader` for compliance events, routing decisions, budget state, and alerts scoped to its supervised agents.

**Supervisor Tool** (new file: `src/tools/supervisor-status.ts`):

```typescript
interface SupervisorStatusTool {
  // Returns recent activity for supervised agents
  getAgentActivity(agentIds: string[], since: string): ComplianceEvent[];
  // Returns budget state for all supervised agents
  getAgentBudgets(agentIds: string[]): BudgetState[];
  // Returns active alerts for supervised agents
  getAgentAlerts(agentIds: string[], since: string): Alert[];
  // Returns aggregate workforce metrics
  getWorkforceMetrics(agentIds: string[]): WorkforceMetrics;
}
```

This tool is registered as an OpenClaw tool definition in the supervisor's config partial and backed by `StorageReader` queries.

**config.partial.json**:
```json
{
  "agents": {
    "defaults": {
      "tools": {
        "custom": [
          {
            "name": "clawforce_workforce_status",
            "description": "Query status, activity, costs, and alerts for the AI workforce",
            "parameters": { ... }
          }
        ]
      }
    }
  }
}
```

**Tests**:
- Template files exist and are valid
- SKILL.md contains required sections (monitoring, reporting, escalation)
- config.partial.json generates valid OpenClaw config when merged
- Supervisor tool queries return correct data from StorageReader

---

### 2B.3 Dashboard Multi-Agent View

**Goal**: Update the monitoring dashboard to show all agents with per-agent and aggregate views.

**Key Files to Modify** (in `clawforce-dashboard/`):
- `app/api/status/route.ts` — Return per-agent status
- `app/api/activity/route.ts` — Support `?agentId=` filter
- `app/api/cost/route.ts` — Per-agent cost breakdown
- `app/api/stream/route.ts` — SSE stream with agent-scoped events
- `components/ActivityFeed.tsx` — Agent selector/filter
- `components/CostTracker.tsx` — Per-agent cost tabs
- `components/AgentOverview.tsx` — New: workforce overview panel

**Design**:

1. **Agent selector**: Dropdown at the top of the dashboard to filter by agent or show "All Agents"
2. **Workforce overview panel**: Shows all agents with status (active/idle/error), current task, daily cost, and model being used
3. **Per-agent drill-down**: Clicking an agent in the overview shows its activity feed, cost, and alerts
4. **Aggregate view**: "All Agents" shows total cost, total events, and a cross-agent timeline

**Data layer**: The SQLite schema already has `agent_id` in `compliance_events`, `routing_decisions`, `budget_state`, and `alerts`. The `StorageReader` already accepts agent ID filters. The dashboard API routes just need to pass the filter through.

**Tests**:
- API routes return agent-filtered data when `?agentId=` is provided
- API routes return all data when no filter
- Dashboard components render with multi-agent data
- SSE stream includes agent ID in events

---

### 2B.4 Inter-Agent Communication

**Goal**: Enable agents to send messages to each other and have all inter-agent communication logged.

**Implementation approach**: Leverage OpenClaw's existing channel routing. Create an internal "webhook" channel type for inter-agent messages. When the supervisor sends a directive to a sub-agent, it routes through OpenClaw's channel system and gets logged in the compliance trail.

**Key mechanism**: OpenClaw's `message` tool already allows agents to send messages to channels. If agents share a common internal channel (e.g., `#agent-internal`), they can communicate naturally. The supervisor uses the `message` tool to send directives, and sub-agents can escalate by sending to the ops channel.

**Config generation**: The multi-agent config generator should:
1. Create a shared internal channel for inter-agent communication
2. Add bindings so the supervisor can reach sub-agent channels
3. Configure the compliance logger to tag inter-agent messages

**Tests**:
- Internal channel is created in generated config when `supervises` is specified
- Messages between agents are logged in compliance trail
- Supervisor can query sub-agent activity

---

### Phase 2B Exit Criteria

- `clawforce deploy` with 3+ agents running simultaneously
- Each agent has isolated workspace, skills, channels, and budget
- Supervisor agent produces daily summary of workforce activity
- Dashboard shows all agents with per-agent and aggregate views
- Inter-agent communication works and is logged
- All existing single-agent tests continue to pass (backward compatibility)
- New tests cover multi-agent config, supervisor template, dashboard, and inter-agent flows

---

## Phase 2C: Template Library & Cross-Tool Integration (Weeks 8-10)

**Goal**: 10+ agent templates with deep tool integrations for pilot deployments
**Duration**: ~3 weeks
**Cost**: ~$500 (API testing)

### 2C.1 Expanded Template Library

Build 7 additional role templates (bringing total to 10+):

| # | Template | Description | Key Skills |
|---|----------|-------------|------------|
| 4 | Meeting Prep Agent | Researches attendees before calendar events, delivers briefing | calendar-read, web-research, contact-lookup |
| 5 | Invoice Processor | Watches email for invoices, extracts data, flags discrepancies | email-watch, pdf-parse, spreadsheet-write |
| 6 | Compliance Monitor | Daily cron checks regulatory websites, flags changes | web-research, cron, digest-generation |
| 7 | Customer Response Drafter | Monitors support inbox, drafts responses, holds for approval | email-watch, draft-compose, approval-gate |
| 8 | Report Generator | Weekly aggregation from multiple sources, formatted report | data-query, report-format, channel-deliver |
| 9 | Sales Research Agent | Prospect research, CRM enrichment, outreach drafting | web-research, crm-query, email-draft |
| 10 | Competitive Intelligence | Monitors competitors, delivers daily briefing | web-monitor, digest-generation, channel-deliver |

Each template includes:
```
templates/<role-name>/
  ├── SKILL.md              # Agent behavior instructions
  ├── config.partial.json   # Routing rules, channel config, budget defaults
  ├── README.md             # Setup guide and prerequisites
  └── test-scenarios/       # Validation scripts for the role
```

### 2C.2 Tool Integration Framework

Standardized tool registration for common enterprise tools:

**Pre-built integrations**:
- **Google Workspace** (Gmail read/send, Calendar events, Drive file access, Sheets read/write)
- **Notion** (page read/write, database queries, workspace search)
- **Linear/Jira** (issue creation, status updates, sprint queries)
- **Salesforce/HubSpot** (contact lookup, deal updates, activity logging)

**Config pattern**:
```yaml
integrations:
  google_workspace:
    credentials_path: ./secrets/google-sa.json
    scopes: [gmail.readonly, calendar.events, drive.readonly]
  notion:
    api_key_env: NOTION_API_KEY
    workspace_id: "abc123"
```

Each integration generates OpenClaw tool definitions that agents can invoke. All tool calls pass through the compliance logger.

### 2C.3 Enterprise Onboarding Wizard

Interactive CLI wizard (`clawforce init`) that guides setup:

1. Infrastructure check (Docker version, GPU detection, disk space, network)
2. Channel connection setup (connector channel, Teams bot, email IMAP/SMTP)
3. Agent role selection from template library
4. Security policy configuration (sensitivity keywords, cloud allowlist)
5. Model selection wizard (local-only vs hybrid vs cloud-primary, GPU auto-detection)
6. Integration setup (Google Workspace, Notion, etc.)
7. Test run (verify agent responds correctly in connected channels)

Outputs a complete `clawforce.yaml` ready for `clawforce deploy`.

### 2C.4 Dashboard Configuration & Management UX

- **Config editing in dashboard**: Change routing rules, budget limits, model preferences from UI
- **Agent management UI**: Start/stop/restart agents from dashboard
- **Routing decision explainer**: Per-activity-item visual showing WHY a request was routed to a specific model
- **Route-test from dashboard**: Run `clawforce route-test` equivalent from UI

### Phase 2C Exit Criteria

- 10+ role templates available and documented
- At least 2 tool integrations (Google Workspace + Notion) working end-to-end
- `clawforce init` wizard produces working configs from scratch
- Dashboard supports basic config editing and model health visibility

---

## Phase 3: Monetization & Compliance (Weeks 11-16)

**Goal**: Convert pilot deployments to paying customers
**Duration**: ~6 weeks
**Cost**: ~$30K (SOC 2) + $2K/month

### 3.1 Usage Metering & Billing Engine

- Token-level usage tracking per agent, per model, per day
- Billing calculation engine:
  - Base platform fee (configurable)
  - Per-agent fees (role-based pricing tiers)
  - Cloud model pass-through with margin
  - Local model compute time (optional, for managed GPU)
- Invoice generation (PDF/HTML)
- Usage dashboard tab with drill-down (by agent, by model, by day)
- Stripe integration for automated billing (stretch goal)

### 3.2 ROI Calculator & Reporting

- Automated weekly ROI reports per deployment
- Metrics: tasks completed, tokens processed, cost savings vs human equivalent, uptime
- "What-if" analysis: "If you routed X% more to local models, you'd save $Y"
- Exportable reports (PDF) for executive stakeholders

### 3.3 SOC 2 Type I Preparation

- Gap analysis against SOC 2 Trust Service Criteria
- Document existing security controls (sandbox isolation, PII routing, audit logging, credential isolation)
- Implement missing controls:
  - Access logging for all admin actions
  - Configuration change audit trail
  - Incident response procedures
  - Data retention policies (log rotation + archival)
  - Encryption at rest for compliance logs
- Engage fast-track auditor ($25-40K, 4-8 weeks)

### 3.4 Dashboard Testing & Hardening

- API route unit tests (status, activity, cost, timeseries, stream)
- React component tests with @testing-library/react
- End-to-end tests with Playwright (login -> view dashboard -> verify data)
- Error boundary components
- Offline/degraded mode (dashboard works when gateway is unreachable)
- Mobile-responsive layout

### Phase 3 Exit Criteria

- Usage metering captures all billable events
- Billing calculation matches expected pricing model
- ROI reports generate automatically for pilot customers
- SOC 2 Type I audit initiated (or completed)
- Dashboard has full test coverage

---

## Phase 4: Scale & Fundraise (Weeks 17-24)

**Goal**: Multi-tenant platform ready for seed fundraise
**Duration**: ~8 weeks
**Cost**: Variable

### 4.1 Kubernetes Deployment

- Helm chart for Kubernetes deployment
- StatefulSet for agents with persistent volumes
- GPU node affinity for local model inference pods
- Horizontal pod autoscaling based on request volume
- Ingress configuration with TLS
- ConfigMap/Secret management for clawforce.yaml

### 4.2 Multi-Tenant Control Plane

- Central management dashboard for multiple customer deployments
- Customer isolation (namespace-level in Kubernetes)
- Per-customer configuration, billing, and compliance views
- Admin API for programmatic management
- Tenant provisioning automation

### 4.3 Agent Marketplace

- Template registry where customers can browse, install, and share agent roles
- Version management for templates
- Rating/review system
- Custom template creation and publishing

### 4.4 Advanced Model Intelligence

- Learning loop: track which model selections produce best outcomes per task type
- A/B testing framework for routing rules
- NLP/ML-based content classification (beyond regex PII detection)
- Enterprise DLP integration (Nightfall, Lakera)
- Multi-language PII patterns (EU, APAC, LATAM)

### Phase 4 Exit Criteria

- Kubernetes deployment working for 2+ customers
- Multi-tenant dashboard operational
- At least 2 case studies with real numbers
- Seed fundraise materials prepared

---

## Timeline & Budget

| Phase | Duration | Cost | Milestone |
|-------|----------|------|-----------|
| ~~2A: Production Readiness~~ | ~~4 weeks~~ | ~~$0~~ | ~~Complete~~ |
| **2B: Multi-Agent (Ultron)** | **4 weeks** | **~$500** | **Multi-agent demo with supervisor** |
| 2C: Templates & Tools | 3 weeks | ~$500 | 10+ templates, onboarding wizard |
| 3: Monetize | 6 weeks | ~$30K + $2K/month | First paying customers |
| 4: Scale | 8 weeks | Variable | Seed fundraise ready |

**Total to first revenue**: ~3 months from now, ~$35K out of pocket (mostly SOC 2).

---

## Design Partner Pilot Requirements

Target: 2-3 companies, 100-500 employees, ideally regulated industries

**Minimum viable for pilot**:
- Phase 2B complete (multi-agent with supervisor)
- At least 5 templates relevant to their industry
- Working tool integrations for their stack (chat connector + at least one of: Google Workspace, Notion, Jira)

**Pilot structure**:
- Duration: 8-12 weeks
- Deployment: 3-5 agents per customer (multi-agent with supervisor)
- Weekly reviews: Usage data, cost savings, issues, feedback
- Success criteria defined upfront per customer

---

## Key Architectural Decisions

### Why Single Gateway for Multi-Agent
OpenClaw's `before_agent_start` hook receives `ctx.agentId`, enabling per-agent routing decisions within a single process. OpenClaw's 8-tier priority binding system natively routes messages to the correct agent based on channel, peer, and other criteria. Running one gateway is simpler, uses less resources, and avoids inter-container communication complexity.

### Why Ultron as a Template, Not Infrastructure
The supervisor agent is implemented as a SKILL.md template with access to sub-agent compliance logs via a custom tool, not as a separate orchestration layer. This keeps the architecture simple and leverages OpenClaw's existing agent capabilities.

### Why Docker Compose Before Kubernetes
Docker Compose is simpler to debug, faster to iterate, and sufficient for single-tenant deployments through Phase 3. Kubernetes adds operational complexity that slows down pilot iteration.

### Why SQLite + JSONL Dual-Write
JSONL is the write-ahead log for durability and SIEM export. SQLite (`node:sqlite`, built into Node.js 22+) is the queryable backing store. Same approach as OpenClaw's built-in RAG/memory system.

### Why OpenClaw's Hook System Is Sufficient
The `before_agent_start` hook with `modelOverride`/`providerOverride` gives full control over model selection. Combined with `message_sending` for output filtering and `tool_result_persist` for tool scanning, we intercept all points needed for security and routing without forking OpenClaw.
