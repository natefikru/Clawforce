# Clawforce: Forward Roadmap

**Date**: 2026-02-15
**Starting Point**: Post-MVP (Phases 0, 1, partial Phase 3, Phase 2A.1, Phase 2A.2, and Phase 2A.3 complete)
**Built On**: OpenClaw (open-source personal AI assistant)

---

## Current State (What's Shipped)

All work shipped on `main` branch. 789 tests passing (666 root + 123 dashboard) with 80% coverage enforced.

| Component | Status | Tests | Notes |
|-----------|--------|-------|-------|
| CLI (deploy, status, stop, audit, route-test, migrate, user) | Complete | 666 | Full lifecycle management + SQLite migration + user management |
| 5-Dimension Model Router | Complete | ~200 | PII, complexity, domain, budget, data policy |
| PII Detection (11 types + adversarial defense) | Complete | ~80 | Unicode normalization, homoglyph folding |
| Output Filtering (PII redaction) | Complete | ~30 | message_sending + tool_result_persist hooks |
| Compliance Logger (JSONL + SQLite dual-write) | Complete | ~40 | Session lifecycle via agent_end hook |
| Compliance Profiles (HIPAA, PCI-DSS, GDPR, CCPA, SOX) | Complete | ~20 | Framework-specific policy enforcement |
| Budget Tracking (daily limits, SQLite-backed) | Complete | ~23 | Auto-fallback to local models, SQLite upsert |
| SQLite Storage Layer | **Complete** | 87 | Dual-write, StorageWriter/Reader, migrations, migrate CLI |
| Dashboard Auth (Auth.js v5, RBAC) | **Complete** | 112 | Multi-user, JWT sessions, login page, middleware, user CLI |
| Real-Time Event Streaming (SSE) | **Complete** | 45 | Multiplexed SSE, cursor-based reconnection, 3 poll sources |
| Dashboard (Status, Activity, Cost, Tasks) | Complete | 45 | Next.js, SQLite-first queries, 4 panels, 3 cost tabs |
| Docker Compose Generation (OpenClaw + Ollama) | Complete | ~30 | Includes SGLang/vLLM runtime options |
| 3 Role Templates | Complete | ~10 | Inbox Analyst, Research Agent, Process Automator |
| Config System (clawforce.yaml -> openclaw.json) | Complete | ~30 | Zod validation, capability profiles |
| OpenClaw Plugin Integration | Complete | — | before_agent_start hook with modelOverride/providerOverride |

**What's NOT built**: Multi-agent orchestration, alert system, billing, onboarding wizard, health monitoring/failover, cross-tool coordination layer, expanded template library.

---

## Strategic Direction

### The Calacanis Signal

Jason Calacanis's team is running OpenClaw in production with multiple "replicants" (persona agents) coordinated by "Ultron" (a meta-agent that supervises sub-agents). Key insights from their usage:

1. **Workflow execution > Q&A** — Value comes from agents taking actions across tools, not answering questions
2. **Multi-agent coordination is the killer feature** — Ultron pattern: one supervisory agent managing many task agents
3. **Cross-tool automation drives adoption** — Slack + Notion + Gmail + databases in unified workflows
4. **Skills as units of work** — Modular, composable capabilities per agent
5. **Data control is non-negotiable** — Private deployment is a hard requirement, not a nice-to-have

### Product Thesis (Updated)

Clawforce deploys **coordinated AI workforces** (not individual agents) into enterprise infrastructure. The differentiation is:

- **Ultron pattern**: A supervisory agent that manages, monitors, and reports on sub-agents
- **Data sovereignty**: PII never leaves the network, enforced at the routing layer
- **Cost intelligence**: 60-80% savings through local model routing with safety invariants
- **Compliance by default**: Audit trail, framework profiles, output filtering — all built in

The pitch shifts from "deploy an AI employee" to "deploy an AI department."

---

## Phased Roadmap

### Phase 2A: Production Readiness (Weeks 1-4)
**Goal**: Make the existing features production-safe for real deployments

These are blockers that must be resolved before putting Clawforce in front of any external user or design partner. No new features — just hardening what exists.

#### 2A.1 SQLite Storage Layer (Foundation) — COMPLETE ✅
- Embedded SQLite database using `node:sqlite` (built into Node.js 22+, same as OpenClaw's memory system)
- Zero external dependencies, zero configuration for the end user
- **Schema**: 6 tables — `compliance_events`, `routing_decisions`, `usage_metrics`, `budget_state`, `alerts`, `schema_version` + 15 indexes
- **Dual-write architecture**: JSONL stays as write-ahead log (durability + SIEM export), SQLite is the query layer
- `StorageWriter`: dual-writes to JSONL + SQLite on every event with cached prepared statements
- `StorageReader`: 8 typed query methods with SQL filtering (by agent, event type, time range, PII flag)
- `BudgetTracker`: SQLite-first load with JSON fallback, dual-write save
- Dashboard activity route: SQLite-first with JSONL fallback
- `clawforce audit --source database` with `--since`, `--event`, `--agent`, `--pii-only` filters
- `clawforce migrate` command to backfill existing JSONL into SQLite (byte-offset watermarking for idempotent reruns)
- WAL mode + busy_timeout for multi-process safety
- 87 new tests, 632 total passing
- **Merged**: PR #3, 9 commits, 25 files, +4317/-28 lines
- **Detailed plan**: [`docs/plans/sqlite-storage-layer.md`](docs/plans/sqlite-storage-layer.md)

#### 2A.2 Dashboard Authentication — COMPLETE ✅
- Auth.js v5 (NextAuth) with Credentials provider, JWT sessions (stateless, no session table)
- Multi-user support with role-based access control (`admin` / `viewer`)
- User storage in SQLite `dashboard_users` table (V2 migration) with bcrypt password hashing
- Login page with server actions, dark theme matching dashboard design
- Next.js middleware protects all routes: pages redirect to `/login`, API routes return 401
- Backward compatible: dashboard remains open when `AUTH_SECRET` env var is absent
- `clawforce user add/list/remove` CLI commands for user management with password and role validation
- Admin user seeded host-side during `clawforce deploy` (data volume is `:ro` in Docker)
- Config schema extended: `dashboard.auth` with `.refine()` validation (requires username + password when enabled)
- `generate-env` produces `AUTH_SECRET`, `generate-compose` passes `AUTH_SECRET` + `AUTH_TRUST_HOST`
- ActivityFeed component handles 401 errors with redirect to login
- 112 new tests (744 total: 666 root + 78 dashboard)
- **Merged**: PR #4
- **Why**: Anyone reaching port 3000 could previously read compliance data. Blocker for any external deployment.

#### 2A.3 Real-Time Event Streaming — COMPLETE ✅
- Single multiplexed SSE stream replacing polling for activity feed, cost, and agent status
- Three poll sources: activity (1.5s, SQLite cursor-based), cost (5s, budget_state diffing), status (10s, Docker container state)
- `Last-Event-ID` reconnection with missed-event replay (capped at 500, sync event on truncation)
- JSONL fallback path preserved with named `event: activity` events for client compatibility
- Shared `lib/db.ts` module consolidating duplicate `getReadDb()` implementations
- `container-status.ts` extracted as shared utility with exponential backoff after failures
- `lib/sse.ts` provides spec-compliant SSE formatting and `createPollingStream()` multiplexer
- ActivityFeed component updated for named event handlers (`addEventListener`) with cost/status display
- 45 new tests (789 total: 666 root + 123 dashboard)
- **Merged**: PR #5
- **Why**: Polling was too slow for live demos and operational monitoring.

#### 2A.4 Model Health Monitoring & Failover
- Health check loop for local models (Ollama, SGLang, vLLM)
- Circuit breaker: if local model is down, block requests rather than cascading PII to cloud
- Health status exposed in dashboard and CLI (`clawforce status`)
- Health events written to SQLite `alerts` table
- Configurable failover policy: `block`, `queue`, or `failover-safe` (only non-sensitive to cloud)
- **Why**: If local model goes down, PII could cascade to cloud. This is a security invariant violation.

#### 2A.5 Alert System
- Agent errors/failures -> admin notification (Slack webhook, email, or dashboard)
- Cost budget exceeded -> alert + optional auto-block
- PII detected heading to cloud (invariant violation attempt) -> alert
- Model health degradation -> alert
- Agent idle for configurable period -> alert
- Alert history stored in SQLite `alerts` table with acknowledgment tracking
- Alert configuration in clawforce.yaml
- Dashboard alert panel with real-time updates (via SSE from 2A.3)
- **Why**: Operators need visibility into failures without watching the dashboard constantly.

#### 2A.6 Plugin TypeScript Compilation Pipeline
- Build `.ts` -> `.js` before copying to OpenClaw extensions directory
- Source maps for debugging
- Watch mode for development
- **Why**: Currently copies raw `.ts` files. OpenClaw expects compiled JavaScript.

**Phase 2A Dependency Graph**:
```
2A.1 SQLite Storage ──┬──> 2A.2 Dashboard Auth
                      ├──> 2A.3 Real-Time Streaming ──> 2A.5 Alert System
                      ├──> 2A.4 Model Health ──────────> 2A.5 Alert System
                      └──> 2A.5 Alert System
2A.6 Plugin Compilation (independent, parallel with any)
```

**Phase 2A Exit Criteria**:
- ~~All operational data queryable via SQLite (compliance events, routing decisions, usage metrics, budget state, alerts)~~ ✅
- ~~JSONL files still written alongside SQLite (dual-write verified)~~ ✅
- ~~Dashboard requires authentication to access~~ ✅
- ~~Activity feed updates in real-time without polling~~ ✅
- Local model failure does NOT cascade PII to cloud
- Alerts fire for all critical conditions
- Plugins are compiled before deployment

---

### Phase 2B: Multi-Agent Orchestration — The Ultron Pattern (Weeks 4-7)
**Goal**: Deploy and manage multiple coordinated AI agents from a single Clawforce instance

This is the highest-value feature gap. The Calacanis team built their own Ultron; we productize it.

#### 2B.1 Multi-Agent Configuration Schema
- Extend `clawforce.yaml` to define multiple agents with distinct:
  - Roles (from template library)
  - Skills (SKILL.md files)
  - Channel assignments (which Slack channels, which email inboxes)
  - Model routing rules (per-agent overrides)
  - Sandbox isolation (per-agent Docker containers via OpenClaw sandbox mode)
  - Budget allocation (per-agent daily limits from shared pool)
- Leverage OpenClaw's existing multi-agent routing (8-tier priority bindings)
- Generate one `openclaw.json` with all agents registered
- **Per-agent budget tracking**: Extend `BudgetTracker` to pass agent IDs (schema supports it, currently hardcoded `_global`)
- **Per-agent compliance logging**: Scope compliance events to agent ID for filtering and dashboard views
- **Docker Compose generation for N agents**: Dynamically generate services for each configured agent

```yaml
# clawforce.yaml - multi-agent example
agents:
  - name: inbox-analyst
    role: inbox-analyst
    channels:
      - type: slack
        channels: ["#inbox-triage", "#action-items"]
    routing:
      budget_daily: 5.00
    skills:
      - inbox-triage
      - thread-summarizer

  - name: research-agent
    role: research-agent
    channels:
      - type: slack
        channels: ["#research-requests"]
    routing:
      budget_daily: 8.00
      prefer_cloud_for: ["deep-research"]
    skills:
      - web-research
      - report-generation

  - name: ultron
    role: supervisor
    channels:
      - type: slack
        channels: ["#ai-ops"]
    supervises: [inbox-analyst, research-agent]
    routing:
      budget_daily: 3.00
```

#### 2B.2 Supervisor Agent Template (Ultron)
- New role template: "Supervisor" / "AI Operations Manager"
- Capabilities:
  - Monitor sub-agent activity via compliance logs
  - Generate daily/weekly summary reports of all agent activity
  - Escalate failures or anomalies to human operators
  - Redistribute work when an agent is overloaded or down
  - Answer questions about what the AI workforce is doing
- SKILL.md with instructions for organizational awareness
- Receives aggregated feeds from sub-agent compliance logs

#### 2B.3 Dashboard Multi-Agent View
- Agent selector / overview panel showing all agents
- Per-agent activity feeds, cost tracking, and status
- Aggregated "workforce" view: total cost, total tasks, health overview
- Supervisor agent's reports surfaced as dashboard cards
- Cross-agent activity timeline

#### 2B.4 Inter-Agent Communication
- Message passing between agents via internal channels
- Supervisor can issue directives to sub-agents
- Sub-agents can escalate to supervisor
- All inter-agent communication logged in compliance trail
- Implementation: leverage OpenClaw's existing channel routing + internal webhook channel

**Phase 2B Exit Criteria**:
- `clawforce deploy` with 3+ agents running simultaneously
- Each agent has isolated sandbox, skills, channels, and budget
- Supervisor agent produces daily summary of workforce activity
- Dashboard shows all agents with per-agent and aggregate views
- Inter-agent communication works and is logged

---

### Phase 2C: Template Library & Cross-Tool Integration (Weeks 8-10)
**Goal**: 10+ agent templates with deep tool integrations for pilot deployments

#### 2C.1 Expanded Template Library
Build 7 additional role templates (bringing total to 10+):

4. **Meeting Prep Agent** — Researches attendees before calendar events, delivers briefing via Slack/email
5. **Invoice Processor** — Watches email for invoices, extracts data, flags discrepancies, updates spreadsheets
6. **Compliance Monitor** — Daily cron checks regulatory websites, flags relevant changes, generates weekly digest
7. **Customer Response Drafter** — Monitors support inbox, drafts responses, holds for human approval before sending
8. **Report Generator** — Weekly aggregation from multiple data sources, formatted report delivered to leadership
9. **Sales Research Agent** — Prospect research, company analysis, CRM data enrichment, outreach drafting
10. **Competitive Intelligence Agent** — Monitors competitors (websites, press, social), delivers daily briefing

Each template includes:
```
templates/<role-name>/
  ├── SKILL.md              # Agent behavior instructions
  ├── config.partial.yaml   # Routing rules, channel config, budget
  ├── README.md             # Setup guide and prerequisites
  └── test-scenarios/       # Validation scripts for the role
```

#### 2C.2 Tool Integration Framework
- Standardized tool registration pattern for common enterprise tools
- Pre-built integrations:
  - **Google Workspace** (Gmail read/send, Calendar events, Drive file access, Sheets read/write)
  - **Notion** (page read/write, database queries, workspace search)
  - **Linear/Jira** (issue creation, status updates, sprint queries)
  - **Salesforce/HubSpot** (contact lookup, deal updates, activity logging)
- Integration config in clawforce.yaml:

```yaml
integrations:
  google_workspace:
    credentials_path: ./secrets/google-sa.json
    scopes: [gmail.readonly, calendar.events, drive.readonly]
  notion:
    api_key_env: NOTION_API_KEY
    workspace_id: "abc123"
```

- Each integration generates OpenClaw tool definitions that agents can invoke
- All tool calls pass through compliance logger

#### 2C.3 Enterprise Onboarding Wizard
- Interactive CLI wizard (`clawforce init`) that guides setup:
  1. Infrastructure check (Docker version, GPU detection, disk space, network)
  2. Channel connection setup (Slack workspace, Teams bot, email IMAP/SMTP)
  3. Agent role selection from template library
  4. Security policy configuration (sensitivity keywords, cloud allowlist)
  5. Model selection wizard (local-only vs hybrid vs cloud-primary, GPU auto-detection)
  6. Integration setup (Google Workspace, Notion, etc.)
  7. Test run (verify agent responds correctly in connected channels)
- Outputs a complete `clawforce.yaml` ready for `clawforce deploy`

#### 2C.4 Dashboard Configuration & Management UX
- **Config editing in dashboard**: Change routing rules, budget limits, model preferences from UI (not just CLI)
- **Agent management UI**: Start/stop/restart agents from dashboard
- **Model health status panel**: Visual indicator of local model (Ollama/SGLang/vLLM) health in dashboard
- **Routing decision explainer**: Per-activity-item visual showing WHY a request was routed to a specific model (e.g., "routed to local: PII detected")
- **Route-test from dashboard**: Run `clawforce route-test` equivalent from UI for testing routing decisions
- **Why**: CLI-only config is fine for developers but blocks adoption by operations teams and design partners

**Phase 2C Exit Criteria**:
- 10+ role templates available and documented
- At least 2 tool integrations (Google Workspace + Notion) working end-to-end
- `clawforce init` wizard produces working configs from scratch
- All templates include test scenarios
- Dashboard supports basic config editing and model health visibility

---

### Phase 3: Monetization & Compliance (Weeks 11-16)
**Goal**: Convert pilot deployments to paying customers

#### 3.1 Usage Metering & Billing Engine
- Token-level usage tracking per agent, per model, per day
- Metering data stored in structured format (not just JSONL logs)
- Billing calculation engine:
  - Base platform fee (configurable)
  - Per-agent fees (role-based pricing tiers)
  - Cloud model pass-through with margin
  - Local model compute time (optional, for managed GPU)
- Invoice generation (PDF/HTML)
- Usage dashboard tab with drill-down (by agent, by model, by day)
- Stripe integration for automated billing (stretch goal)

#### 3.2 ROI Calculator & Reporting
- Automated weekly ROI reports per deployment
- Metrics: tasks completed, tokens processed, cost savings vs human equivalent, uptime
- "What-if" analysis: "If you routed X% more to local models, you'd save $Y"
- Exportable reports (PDF) for executive stakeholders
- Template QBR deck generation

#### 3.3 SOC 2 Type I Preparation
- Gap analysis against SOC 2 Trust Service Criteria
- Document existing security controls (sandbox isolation, PII routing, audit logging, credential isolation)
- Implement missing controls:
  - Access logging for all admin actions
  - Configuration change audit trail
  - Incident response procedures
  - Data retention policies (log rotation + archival)
  - Encryption at rest for compliance logs
- Engage fast-track auditor ($25-40K, 4-8 weeks)
- Deliverable: SOC 2 Type I report

#### 3.4 Dashboard Testing & Hardening
- API route unit tests (status, activity, cost, timeseries, stream)
- React component tests with @testing-library/react
- End-to-end tests with Playwright (login -> view dashboard -> verify data)
- Error boundary components
- Offline/degraded mode (dashboard works when gateway is unreachable)
- Mobile-responsive layout

**Phase 3 Exit Criteria**:
- Usage metering captures all billable events
- Billing calculation matches expected pricing model
- ROI reports generate automatically for pilot customers
- SOC 2 Type I audit initiated (or completed)
- Dashboard has full test coverage

---

### Phase 4: Scale & Fundraise (Weeks 17-24)
**Goal**: Multi-tenant platform ready for seed fundraise

#### 4.1 Kubernetes Deployment
- Helm chart for Kubernetes deployment
- StatefulSet for agents with persistent volumes
- GPU node affinity for local model inference pods
- Horizontal pod autoscaling based on request volume
- Ingress configuration with TLS
- ConfigMap/Secret management for clawforce.yaml

#### 4.2 Multi-Tenant Control Plane
- Central management dashboard for multiple customer deployments
- Customer isolation (namespace-level in Kubernetes)
- Per-customer configuration, billing, and compliance views
- Admin API for programmatic management
- Tenant provisioning automation

#### 4.3 Agent Marketplace
- Template registry where customers can browse, install, and share agent roles
- Version management for templates
- Rating/review system
- Custom template creation and publishing
- Revenue share model for third-party template authors

#### 4.4 Advanced Model Intelligence
- Learning loop: track which model selections produce best outcomes per task type
- A/B testing framework for routing rules
- NLP/ML-based content classification (beyond regex PII detection)
- Enterprise DLP integration (Nightfall, Lakera) for customers with existing DLP
- Multi-language PII patterns (EU, APAC, LATAM)

#### 4.5 Case Studies & Go-to-Market
- 2-3 detailed case studies with real cost/productivity numbers
- Landing page with demo video
- Sales collateral (pitch deck, one-pagers, competitive matrix)
- Pricing page
- Self-service trial signup (stretch)

**Phase 4 Exit Criteria**:
- Kubernetes deployment working for 2+ customers
- Multi-tenant dashboard operational
- At least 2 case studies with real numbers
- Seed fundraise materials prepared

---

## Priority Matrix

| Feature | Business Value | Technical Risk | Dependencies | Phase |
|---------|---------------|----------------|--------------|-------|
| ~~SQLite Storage Layer~~ | ~~CRITICAL (foundation)~~ | ~~LOW~~ | ~~None~~ | ~~2A.1~~ ✅ |
| ~~Dashboard Auth~~ | ~~HIGH (security blocker)~~ | ~~LOW~~ | ~~SQLite (2A.1)~~ | ~~2A.2~~ ✅ |
| ~~Real-Time Streaming~~ | ~~MEDIUM (demo quality)~~ | ~~LOW~~ | ~~SQLite (2A.1)~~ | ~~2A.3~~ ✅ |
| Model Health/Failover | HIGH (security invariant) | MEDIUM | SQLite (2A.1) | 2A.4 |
| Alert System | HIGH (operational need) | LOW | SQLite + Streaming + Health (2A.1-4) | 2A.5 |
| Multi-Agent Config | CRITICAL (core differentiator) | MEDIUM | OpenClaw bindings | 2B |
| Supervisor Template | CRITICAL (Ultron pattern) | HIGH | Multi-agent (2B.1) | 2B |
| Dashboard Multi-Agent | HIGH (pilot requirement) | MEDIUM | Multi-agent (2B.1) | 2B |
| Template Expansion | HIGH (pilot variety) | LOW | None | 2C |
| Onboarding Wizard | MEDIUM (friction reduction) | LOW | Templates (2C.1) | 2C |
| Tool Integrations | HIGH (cross-tool value) | HIGH | OpenClaw tools | 2C |
| Billing Engine | HIGH (revenue enabler) | MEDIUM | Metering infra | 3 |
| SOC 2 | HIGH (enterprise moat) | LOW (process) | Existing controls | 3 |
| Kubernetes | MEDIUM (scale prep) | HIGH | Docker Compose | 4 |
| Multi-Tenant | MEDIUM (scale prep) | HIGH | Kubernetes | 4 |

---

## Timeline & Budget (Updated)

| Phase | Duration | Cost | Milestone |
|-------|----------|------|-----------|
| 2A: Production Readiness | 4 weeks | $0 (dev time) | Deployable to external users |
| 2B: Multi-Agent (Ultron) | 4 weeks | ~$500 (API testing) | Multi-agent demo with supervisor |
| 2C: Templates & Tools | 3 weeks | ~$500 (API testing) | 10+ templates, onboarding wizard |
| 3: Monetize | 6 weeks | ~$30K (SOC 2) + $2K/month | First paying customers |
| 4: Scale | 8 weeks | Variable | Seed fundraise ready |

**Total to first revenue**: ~4 months from now, ~$35K out of pocket (mostly SOC 2).

---

## Design Partner Pilot Structure

Target: 2-3 companies, 100-500 employees, ideally regulated industries (finance, healthcare, legal)

**Pilot Program:**
- Duration: 8-12 weeks
- Pricing: Free during pilot, outcome-based pricing after
- Deployment: 3-5 agents per customer (multi-agent with supervisor)
- Weekly reviews: Usage data, cost savings, issues, feedback
- Success criteria defined upfront per customer (e.g., "60% inbox triage automated", "10hrs/week saved per department")
- Phase gate: Week 8 go/no-go for paid deployment

**What pilots need (minimum viable):**
- Phase 2A complete (auth, streaming, health monitoring, alerts)
- Phase 2B complete (multi-agent with supervisor)
- At least 5 templates relevant to their industry
- Working tool integrations for their stack (Slack + at least one of: Google Workspace, Notion, Jira)

---

## Technical Debt & Deferred Items

| Item | Priority | Notes |
|------|----------|-------|
| Plugin copies `.ts` instead of `.js` | Phase 2A | No build step exists yet |
| Output filter double-normalization | Low | Idempotent but wasteful; optimize when profiling shows need |
| Dashboard API route tests | Phase 3 | Separate Next.js project, add during hardening |
| Dashboard React component tests | Phase 3 | Need @testing-library/react setup |
| NLP/ML content classification | Phase 4 | Regex covers ~5% of enterprise-sensitive data |
| Multi-language PII patterns | Phase 4 | English/US only currently |
| Enterprise DLP integration | Phase 4 | For customers with existing DLP infrastructure |

---

## Key Architectural Decisions

### Why OpenClaw's Hook System Is Sufficient
The `before_agent_start` hook with `modelOverride`/`providerOverride` gives us full control over model selection. Combined with `message_sending` for output filtering and `tool_result_persist` for tool scanning, we intercept all the points needed for security and routing without forking OpenClaw.

### Why Docker Compose Before Kubernetes
Docker Compose is simpler to debug, faster to iterate, and sufficient for single-tenant deployments (which is all we need through Phase 3). Kubernetes adds operational complexity that slows down pilot iteration. Move to Kubernetes when multi-tenant demand requires it.

### Why SQLite + JSONL Dual-Write (Not Postgres, Not JSONL-Only)
JSONL is kept as a write-ahead log for durability, portability, and SIEM export. SQLite (`node:sqlite`, built into Node.js 22+) is added as the queryable backing store. This gives us indexed queries for the dashboard, audit, alerts, and billing without adding any external infrastructure. The dual-write ensures that if SQLite has an issue, the JSONL source of truth is intact. Postgres is deferred to Phase 4 — SQLite handles millions of rows and is sufficient through multi-agent pilot deployments. OpenClaw itself uses the same `node:sqlite` + `sqlite-vec` approach for its built-in RAG/memory system, so this aligns with the upstream architecture.

### Why Clawforce Manages Its Own Storage (Not the User)
The SQLite database is embedded and zero-config. The user never sees it, configures it, or manages it. It lives inside the Clawforce data directory (`/home/node/.openclaw/data/clawforce.db`), gets created automatically on first run, and migrates itself on upgrades. OpenClaw handles its own storage (sessions, transcripts, RAG/memory) independently. Clawforce only manages its operational data: compliance events, routing decisions, usage metrics, budget state, and alerts.

### Why Build Ultron as a Template, Not Infrastructure
The supervisor agent is implemented as a SKILL.md template with access to sub-agent compliance logs, not as a separate orchestration layer. This keeps the architecture simple and leverages OpenClaw's existing agent capabilities. If we need tighter coordination later, we can add an orchestration plugin.
