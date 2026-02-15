# Clawforce: Enterprise AI Workforce Platform

**Date**: 2026-02-14
**Status**: Pre-MVP Research & Planning
**Built On**: OpenClaw (open-source personal AI assistant)

---

## Executive Summary

Clawforce is a managed platform that deploys, monitors, and bills pre-configured AI agents ("AI employees") into enterprise infrastructure. Built on top of the open-source OpenClaw project, the platform solves the #1 blocker to enterprise AI adoption: **data security and compliance**.

**One-liner**: Deploy AI employees on your infrastructure. Your data never leaves.

**The pitch**: We're building the enterprise deployment platform for autonomous AI agents. Think Red Hat for AI workers. Companies deploy our platform in their own infrastructure -- their data never leaves their network. We provide pre-built AI agent templates that replace specific business functions. Our model routing layer automatically picks the cheapest AI model that can handle each task, cutting inference costs 60-80%. Early customers replace $500K+ in annual outsourcing spend with $50K in AI agent subscriptions.

---

## The Problem

- **95% of enterprise AI pilots fail** (MIT, 2025) -- the #1 reason is data security and compliance concerns
- Companies are choosing between "use AI unsecurely" or "don't use AI at all"
- Regulated industries (finance, healthcare, legal, government) are locked out entirely
- Existing solutions are either security-only (can't execute), execution-capable (cloud-only), or self-hosted (can't actually do real work)
- Gartner predicts 75% of EU/ME enterprises will "geopatriate" workloads by 2030 (up from <5% in 2025)

---

## The Market Gap

```
                        CAN EXECUTE REAL TASKS
                        (browse, code, message, automate)
                              |
                    NO        |         YES
                              |
    SELF-HOSTED   ----------- + ------------------
    (data stays   Dify        |   CLAWFORCE
     on-prem)     Langflow    |   (THIS IS THE GAP)
                  FlowiseAI   |
                              |
    CLOUD-ONLY   ------------ + ------------------
    (data goes    Portkey      |   Lindy (limited)
     to vendor)   Nightfall    |   Beam AI (limited)
                  Lakera       |   ServiceNow (locked in)
```

**No existing platform** combines self-hosted deployment + autonomous task execution (browser, code, messaging) + multi-channel presence + compliance logging.

---

## Competitive Landscape

### Layer 1: AI Gateways (API Routing) -- They route API calls, they DON'T execute tasks
- **Portkey** -- Routes to 200+ LLMs, cost tracking, guardrails. 400B+ tokens/day. Starts at $49/month.
- **TrueFoundry MCP Gateway** -- MCP protocol gateway for agentic enterprise. Security + model grounding.
- **Bifrost** -- High-performance AI gateway, 50x faster than Python alternatives.

### Layer 2: AI Security & DLP -- They block data leakage, they DON'T provide AI
- **Nightfall AI** -- DLP for AI apps. Detects sensitive data in prompts.
- **Lakera** -- Guardrails for GenAI apps. Prompt injection protection + DLP.
- **Zscaler AI Security** -- MCP gateway + AI deception tools.
- **Acuvity** (acquired by Proofpoint, Feb 2026) -- AI security and governance.

### Layer 3: AI Agent Platforms (Workflow Builders) -- They build workflows, mostly cloud-only
- **Dify** -- Open-source visual workflow builder. Self-hostable. Limited execution.
- **Langflow** -- Open-source visual builder for multi-agent apps.
- **Lindy** -- Pre-built AI agents. Cloud-only.
- **Beam AI** -- Agentic automation platform. Cloud-only.
- **ServiceNow AI Agents** -- Locked into ServiceNow ecosystem.

### Our Differentiators (NOT just "we use OpenClaw")
1. **Execution + Security + Multi-Channel**: The only self-hosted platform where agents can browse, code, message across all channels -- with full audit trail
2. **Dual-dimension model routing**: Route by BOTH cost AND data sensitivity (nobody else does this)
3. **"AI Employee" abstraction**: Not a tool or workflow -- a hireable worker with role, permissions, channels, cost profile, compliance posture
4. **Compliance certifications as moat**: SOC 2, HIPAA, FedRAMP -- expensive and time-consuming barriers to entry

---

## Unit Economics

### Cost Math
- Running agents heavy on cloud API: ~$300/day = ~$9K/month = ~$110K/year
- With intelligent model routing (70-80% local Ollama): **$30-80/day = $1K-2.5K/month**
- Fully-loaded junior employee: **$8K-15K/month** (salary + benefits + overhead)
- AI agent runs 24/7 = 3-5x human throughput

**Result: $2K/month AI employee vs $12K/month human, running 3x the hours.**

### Local vs Cloud Model Costs
- Cloud API (30M tokens/month): $5K-$10K/month
- Self-hosted Ollama (GPU rental): ~$200-$500/month
- Self-hosted (own GPU workstation): ~$3,000 one-time
- Savings: 60-90% by routing routine tasks to local models

### Pricing Model (Hybrid)
```
Base Platform Fee:      $2,000/month   (deployment, dashboard, compliance, support)
Per AI Employee:        $500-2,000/month (depends on role complexity + model usage)
Cloud Model Pass-through: Cost + 20% margin (only for cloud API calls)
```

- 5-agent deployment: ~$5K-12K/month (still 1/10th the cost of 5 humans)
- 70%+ gross margins (local model inference = near-zero marginal cost)

---

## What OpenClaw Already Provides (DON'T Need to Build)

| Capability | Status | Enterprise Value |
|---|---|---|
| Docker deployment (non-root, health checks) | Built | Kubernetes-ready from day 1 |
| Multi-agent routing (8-tier priority bindings) | Built | One gateway, many isolated agents per department |
| Sandbox mode (per-session Docker containers) | Built | Hard security isolation per agent/tenant |
| Model failover + auth rotation | Built | Cost optimization + resilience baked in |
| 20+ channel connectors (Slack, Teams, WhatsApp, etc.) | Built | Meet workers where they already are |
| Browser automation (Playwright) | Built | Agents can DO things, not just talk |
| Cron scheduling + webhooks | Built | Automation without custom infra |
| Skills system (teachable agents via SKILL.md) | Built | Role-specific behavior |
| Security audit CLI (`openclaw security audit`) | Built | Automated compliance checking |
| Config hot-reload + strict validation | Built | Safe, version-controllable configuration |
| Session isolation + DM scoping | Built | Per-tenant conversation isolation |
| Plugin system (runtime-loaded TypeScript modules) | Built | Extensibility without forking |

---

## What We Build (The Platform Layer)

```
+----------------------------------------------------------+
|                    CLAWFORCE PLATFORM                     |
|              (This is what we build)                      |
|                                                           |
|  +--------------+  +---------------+  +-----------------+ |
|  | Deploy       |  | Monitor       |  | Bill            | |
|  | Manager      |  | Dashboard     |  | Engine          | |
|  +--------------+  +---------------+  +-----------------+ |
|  +--------------+  +---------------+  +-----------------+ |
|  | Agent Role   |  | Model Router  |  | Compliance      | |
|  | Templates    |  | (cost+sec)    |  | Logger          | |
|  +--------------+  +---------------+  +-----------------+ |
|                                                           |
+-------------------------+---------------------------------+
                          |
             +------------+------------+
             |    OpenClaw Gateway     |
             |   (already built)       |
             +-------------------------+
```

---

## Phased MVP Plan

### Phase 0: Foundation (Weeks 1-2)
**Goal**: Get a single OpenClaw instance running as a deployable, configurable product

**Build**:
- **Deployment CLI/script** that takes a `clawforce.yaml` config and produces a running OpenClaw instance
  - Wraps Docker Compose with pre-configured volumes, networking, and secrets
  - Generates `openclaw.json` from a simpler, role-based config format
  - Sets up Ollama sidecar container for local model inference
- **3 starter Agent Role Templates** as SKILL.md + config bundles:
  1. **"Inbox Analyst"** -- monitors Slack/email, summarizes threads, flags action items, delivers daily briefings
  2. **"Research Agent"** -- takes research requests via Slack/Teams, browses web, compiles reports, delivers via channel
  3. **"Process Automator"** -- watches for triggers (webhooks/cron), executes browser-based workflows, reports results

**Tech stack**:
- Deployment: Docker Compose + Helm chart (Kubernetes later)
- Config generator: Node.js CLI tool
- Local models: Ollama sidecar (Llama 3.3 70B for routine, Qwen 2.5 for coding)
- Cloud fallback: Anthropic Claude for complex reasoning (configurable)

**Deliverable**: `clawforce deploy --config clawforce.yaml` spins up a working AI employee in under 5 minutes.

---

### Phase 1: The Demo That Sells (Weeks 3-5)
**Goal**: A live demo for potential design partners and investors

**Build**:

#### 1a. Model Router (Proprietary IP)
Middleware between OpenClaw and LLM providers with dual-dimension routing:

```yaml
# clawforce.yaml - model routing config
routing:
  rules:
    - if: "sensitivity == 'high'"
      then: "ollama/llama3.3:70b"         # Local, free, secure

    - if: "sensitivity == 'low' AND complexity == 'low'"
      then: "ollama/llama3.3:8b"           # Local, fast, cheap

    - if: "sensitivity == 'low' AND complexity == 'high'"
      then: "anthropic/claude-sonnet-4-5"  # Cloud, smart

    - if: "task_type == 'browser_action'"
      then: "anthropic/claude-sonnet-4-5"  # Needs strong reasoning

    - if: "task_type == 'summarize'"
      then: "ollama/llama3.3:8b"           # Simple task, save money
```

**Sensitivity classification**: Scan prompts for PII patterns (SSN, credit cards, names+addresses), company-specific terms (configurable blocklist), and file references. Sensitive data -> route to local model.

**Cost impact**: Drops $300/day to $50-80/day by routing 70-80% of requests to local Ollama.

#### 1b. Activity Dashboard
Simple web dashboard (Next.js) showing:
- **Agent status**: Running AI employees, current state
- **Activity feed**: Last 24h actions (from OpenClaw session JSONL logs)
- **Cost tracker**: Tokens per agent, local vs cloud breakdown, estimated costs
- **Task log**: Completed tasks with outcomes (success/failure/escalated)

Data source: OpenClaw session JSONL files + gateway logs. No new database needed.

#### 1c. Compliance Logger
Append-only audit log capturing:
- Every tool execution (tool, args, result)
- Every model call (which model, tokens, local vs cloud)
- Every channel message (inbound and outbound)
- Every config change

Implementation: OpenClaw hooks system (PostToolUse, etc.) -> structured JSONL -> later proper audit DB.

**Demo Script (15 minutes)**:
1. Deploy an "Inbox Analyst" agent in 5 minutes
2. Send it a Slack message asking to research a competitor
3. Watch it browse the web, compile a report, deliver back to Slack
4. Show dashboard with cost tracking and audit trail
5. "All data stayed on this machine. Research used a local model. Final report used Claude for quality. Total cost: $0.03."

---

### Phase 2: Design Partner Pilot (Weeks 6-12)
**Goal**: 2-3 companies running it for real

**Build**:

#### 2a. Enterprise Onboarding Wizard
Guided setup for IT admins:
1. Infrastructure check (Docker, GPU, network)
2. Channel connection (Slack workspace, Teams bot, etc.)
3. Agent role selection (from template library)
4. Security policy config (what's sensitive, what goes to cloud)
5. Model selection (local-only vs hybrid vs cloud-primary)
6. Test run (verify agent responds correctly)

#### 2b. Expanded Template Library (8-10 roles)
4. **"Meeting Prep Agent"** -- researches attendees before calendar events, delivers briefing
5. **"Invoice Processor"** -- watches email for invoices, extracts data, flags discrepancies
6. **"Compliance Monitor"** -- daily cron checks regulatory websites, flags relevant changes
7. **"Customer Response Drafter"** -- monitors support inbox, drafts responses, holds for approval
8. **"Report Generator"** -- weekly aggregation from multiple sources, formatted report to leadership

Each template is a bundle:
```
templates/invoice-processor/
  +-- SKILL.md              # Agent instructions and behavior
  +-- config.partial.json   # OpenClaw config fragment
  +-- README.md             # Setup guide
  +-- test-scenarios/       # Validation scripts
```

#### 2c. Multi-Agent Management
Multiple AI employees from a single deployment:
- Leverage OpenClaw multi-agent routing (bindings)
- Each agent: own sandbox, skills, model config
- Dashboard shows all agents side-by-side
- Shared channel connections (one Slack workspace -> multiple agents)

#### 2d. Alert System
- Agent errors/failures -> admin Slack alert
- Cost exceeding budget -> alert
- Sensitive data detected heading to cloud -> alert + block
- Agent idle for unusual period -> alert

**Pilot Structure**:
- Duration: 8-12 weeks
- Pricing: Free during pilot, outcome-based after
- Weekly reviews: Usage data, cost savings, issues
- Success criteria: Defined upfront (e.g., "60%+ inbox triage automated")
- Phase gate: Week 8 go/no-go for paid deployment

---

### Phase 3: Monetize (Weeks 13-20)
**Goal**: Convert pilots to paying customers, establish pricing, prepare for fundraise

**Build**:

#### 3a. Billing Engine
Hybrid pricing model:
```
Base Platform Fee:      $2,000/month
Per AI Employee:        $500-2,000/month
Cloud Model Pass-through: Cost + 20% margin
```

#### 3b. SOC 2 Type I (Fast-Track)
- Cost: $25K-$40K
- Timeline: 4-8 weeks with fast-track auditor
- OpenClaw's existing security model (sandbox, credential isolation, audit CLI) provides head start
- Type II (3-6 month observation) comes later

#### 3c. Customer Success Playbook
- Standardized onboarding (2-3 days)
- Weekly automated ROI reports
- Templated QBR deck
- Escalation paths for agent failures

**Target**: 2-3 paying customers at $5K-15K/month = $10K-45K MRR

---

### Phase 4: Scale Prep (Weeks 21-30)
**Goal**: Prepare for seed fundraise

- Kubernetes deployment (Helm chart)
- Multi-tenant control plane (one dashboard, multiple customers)
- Agent marketplace (create and share custom templates)
- Usage analytics (model routing efficiency, cost savings, task completion rates)
- Case studies (2-3 detailed write-ups with real numbers)

---

## Timeline & Budget

| Phase | Duration | Cost | Milestone |
|---|---|---|---|
| Phase 0: Foundation | 2 weeks | $0 (your time) | Deployable single-agent system |
| Phase 1: Demo | 3 weeks | ~$500/month (API testing) | Live investor/partner demo |
| Phase 2: Pilot | 6 weeks | ~$2K/month (infra) + SOC 2 prep | 2-3 design partners running |
| Phase 3: Monetize | 8 weeks | ~$30K (SOC 2) + $2K/month | First paying customers, $10K+ MRR |
| Phase 4: Scale | 10 weeks | Variable | Seed fundraise ready |

**Total to first revenue**: ~4-5 months, ~$35-40K out of pocket (mostly SOC 2).

---

## Go-to-Market Strategy

```
Phase 1: Secure AI Gateway (sell to CISO/CTO)
  -> "Use AI without compromising data security"
  -> Revenue: Platform license

Phase 2: Back Office Automation Templates (sell to COO/CFO)
  -> "Replace $500K/year BPO spend with $50K/year AI agents"
  -> Revenue: Per-workflow subscription

Phase 3: Department-Specific Agent Marketplace (sell to department heads)
  -> Pre-built agents for sales, marketing, finance, HR, legal
  -> Revenue: Per-agent per-month

Phase 4: Multi-Agent Orchestration (sell to CEO)
  -> AI workforce that coordinates across departments
  -> Revenue: Enterprise license
```

---

## The Moat

1. **Data gravity**: Once deployed in customer VPC with system access, switching costs are enormous
2. **Skill/template library**: More customers = better pre-built workflows
3. **Model routing intelligence**: Proprietary data on which models work best for which tasks at which cost
4. **Compliance certifications**: SOC 2, HIPAA, FedRAMP -- expensive barriers to entry
5. **Open-source community**: OpenClaw's community contributes plugins/skills for free

---

## Investor Thesis (Calacanis Fit)

Calacanis investment thesis alignment:
- **"Domain-specific copilots trained on proprietary data"** -- AI employees trained on company-specific workflows
- **"AI-enabled services with high gross margins as automation replaces headcount"** -- Replacing $12K/month humans with $2K/month AI employees
- **"Default alive"** -- 5-10 enterprise customers at $50K+/year covers costs
- **"Chase the problem, not the buzzword"** -- Real problem: enterprises can't use AI safely
- **"AI-native and ruthlessly customer-focused"** -- Built from the ground up, not retrofitted

---

## Immediate Next Steps (This Week)

1. Stand up a single OpenClaw instance with Docker + Ollama sidecar
2. Write the first Agent Role Template (Inbox Analyst SKILL.md)
3. Connect to own Slack workspace and dogfood for a week
4. Create a waitlist landing page
5. Identify 3-5 potential design partners (100-500 employee companies, ideally regulated industries)

---

## Additional Business Cases (Future Expansion)

### AI-Powered Competitive Intelligence
- Always-on agents monitoring competitors, markets, news via cron + browser
- Daily/weekly briefings delivered via Slack/Teams
- Replaces junior analysts at hedge funds, PE firms, corporate strategy ($200K+/year each)
- Revenue: $5K-25K/month per company

### AI Sales Development Platform
- Prospect research, personalized outreach, multi-channel follow-up, CRM updates
- Human SDR: $6K/month + commissions, books 15-20 meetings/month
- AI SDR: $2K/month, runs 24/7, 3-5x meeting volume
- Revenue: $2K-5K/month per seat or $50-200 per meeting booked

### AI Chief of Staff / Executive Decision Support
- Morning briefings, meeting prep, decision support, action tracking
- Saving a CEO 2 hours/day = $1M+/year value at mid-size company
- Revenue: $5K-50K/month per executive team

### Multi-Channel Customer Operations
- Support across every channel simultaneously (WhatsApp, email, Slack, web)
- Agents can actually resolve issues (refunds, account changes, scheduling)
- Revenue: $0.50-5 per resolved ticket (a la Intercom Fin at $0.99/resolution)

### Regulated Industry Compliance Monitoring
- Continuous regulatory monitoring, policy impact analysis, audit preparation
- Sticky customers with long sales cycles but massive LTV
- Revenue: $10K-100K/month per enterprise

---

## Implementation Progress

### Completed (Phases 0-1 + Phase 3 Tier 1 Expansion)

All work shipped on `feat/tier-1-expansion` branch (PR #2), 530 tests passing.

**Phase 0: Foundation** — Complete
- Deployment CLI (`clawforce deploy`, `clawforce generate`)
- Docker Compose generation with Ollama sidecar
- Config schema with Zod validation
- Workspace setup with plugin copying
- 3 starter agent role templates (Inbox Analyst, Research Agent, Process Automator)

**Phase 1: Model Router + Dashboard + Compliance** — Complete
- 5-dimension model router (policy, sensitivity, cost, domain, complexity)
- PII detection with 10 regex patterns + adversarial defense (unicode normalization, homoglyph folding)
- Conversation history scanning (last N messages)
- Hard PII invariant (PII never routes to cloud, even with misconfigured rules)
- Activity dashboard (Next.js) with cost tracker, activity feed, agent status, task log
- Compliance logger plugin with append-only JSONL audit trail
- Budget tracking with daily limits and cost estimation

**Phase 3 Tier 1 Expansion** — Complete
- Policy-based data classification (4 tiers: restricted, confidential, internal, public)
- Channel and user policy routing
- `scanForPII()` API with confidence scoring and match positions
- Output filtering — PII redaction on outbound messages via `message_sending` hook
- Tool result scanning — PII redaction on tool outputs via `tool_result_persist` hook
- Audit logging — session lifecycle events via `agent_end` hook
- Compliance framework profiles (HIPAA, PCI-DSS, GDPR, CCPA, SOX)
- SGLang runtime support (default engine, replacing Ollama as default local model)
- vLLM runtime support
- Default model updated to `sglang/qwen3-32b`

---

## Open Items (Pre-Phase 2)

### Security — Must Fix Before Design Partner Pilots

| # | Severity | Issue | File(s) | Description |
|---|----------|-------|---------|-------------|
| 1 | CRITICAL | Output filter redaction position mismatch | `output-filter.ts`, `pii-detector.ts` | `scanForPII()` returns match positions relative to normalized text, but `filterOutput()` applies those positions to the original text. If input contains zero-width chars, homoglyphs, or fullwidth digits, redaction slices at wrong positions — partially leaking PII or corrupting surrounding text. Fix: maintain a position map during normalization, or redact on normalized text. |
| 2 | CRITICAL | Custom priority ordering bypasses PII hard invariant | `router.ts` | If an operator sets priority to `["domain", "sensitivity", ...]`, domain is evaluated before sensitivity. When PII is present AND domain matches, PII routes to a cloud model — violating the stated hard invariant. Fix: enforce PII check as a post-routing invariant regardless of dimension ordering. |
| 3 | HIGH | `defaultLocalModel` not wired through plugin config | `index.ts`, `router.ts` | `selectModel()` is never passed `defaultLocalModel` from the plugin's `activate()` function. Even if a user configures a custom local model, the PII invariant fallback always uses hardcoded `sglang/qwen3-32b`. Fix: add `defaultLocalModel` to `ResolvedRouterConfig` and pass it through. |
| 4 | HIGH | SSN regex false positives on 9-digit numbers | `pii-detector.ts:87` | Pattern `\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b` matches any 9-digit number (zip+4, order numbers, tracking IDs). High false-positive rate in production. Fix: require at least one separator, or add context-aware check (keyword proximity). |
| 5 | HIGH | IBAN regex false positives | `pii-detector.ts:97` | Pattern `\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b` matches many non-IBAN strings (ISO country codes + numbers like `US2024BUDGET`). Fix: add minimum total length (15+ chars) or check-digit validation. |
| 6 | HIGH | Phone regex false positives | `pii-detector.ts:95` | Pattern matches any 10-digit number including random numeric sequences in code/data. Fix: require at least one separator character (`[-\s.]` instead of `[-\s.]?`). Already fixed in current code. |
| 7 | MEDIUM | "internal" tier cloud routing ambiguity | `data-policy.ts` | `tierAllowsCloud("internal")` returns `false` but `tierRequiresLocal("internal")` also returns `false`. "Internal" tier data can route to cloud models. `tierAllowsCloud()` is exported but never called — dead code. Needs explicit documentation on intent. |

### Dashboard — Fix Before Design Partner Pilots

| # | Severity | Issue | File(s) | Description |
|---|----------|-------|---------|-------------|
| 8 | HIGH | `execSync` blocks event loop in status API | `dashboard/api/status/route.ts` | `execSync('docker ps ...')` blocks ALL request handling for up to 5s on every status poll. Fix: use `execFile` (async) with argument array instead of shell string. |
| 9 | HIGH | No input validation on `limit` query param | `dashboard/api/activity/route.ts` | `parseInt` returns `NaN` for non-numeric input; `?limit=999999999` forces full log serialization. Fix: clamp to `Math.min(Math.max(parsed \|\| 50, 1), 1000)`. |
| 10 | HIGH | Dashboard reads entire log synchronously on every request | `dashboard/api/activity/route.ts`, `dashboard/api/cost/route.ts` | `readFileSync` reads full compliance log into memory on every 5s poll. Becomes a performance issue as log grows. Fix: use `readFile` (async) + tail-based reading. |
| 11 | MEDIUM | No authentication on dashboard API routes | `dashboard/src/app/api/` | Anyone who can reach port 3000 can read the full compliance log, cost data, and container status. Acceptable for Phase 1 local-only deployment, but must be addressed before multi-tenant pilots. |
| 12 | LOW | Complexity analyzer regex statefulness bug | `complexity-analyzer.ts:18-19` | `CODE_BLOCK_PATTERN` and `INLINE_CODE_PATTERN` use `g` flag, making `.test()` stateful — produces incorrect results on every other invocation. Fix: remove `g` flag. |

### Test Coverage Gaps

| # | Issue | Description |
|---|-------|-------------|
| 13 | No overlapping PII match tests for output filter | If two patterns match overlapping ranges, the second replacement corrupts the first marker. |
| 14 | No adversarial evasion tests for output filter path | Output filter tests only use clean ASCII; given position mismatch bug #1, adversarial input would fail. |
| 15 | Passport regex edge cases untested | Spacing variations like `passport # 123456789` and non-US alphanumeric formats not tested. |
| 16 | Integration test doesn't exercise history scanning | `simulateAgentRun` only passes `{ prompt }`, never `messages`. History PII scanning untested at integration level. |
| 17 | No dashboard API route tests | Status, activity, and cost routes lack unit tests (use fs + docker APIs). |
| 18 | No dashboard React component tests | No `@testing-library/react` tests for CostTracker, ActivityFeed, etc. |

### Code Quality (Low Priority)

| # | Issue | Description |
|---|-------|-------------|
| 19 | `resolveConfig` uses unsafe `as` casts | Plugin config values cast without validation; invalid config crashes on first use. |
| 20 | `writeRoutingLog` calls `mkdirSync` on every write | Synchronous syscall on every routing decision. Move to one-time check at activation. |
| 21 | Module-level mutable state in `pricing.ts` | `warnedModels` Set persists across test runs; makes tests potentially order-dependent. |
| 22 | Duplicate JSONL parsing in 3 places | Same split/filter/JSON.parse logic in compliance plugin, dashboard log-parser, and audit command. |
| 23 | Plugin copies `.ts` source instead of compiled `.js` | `workspace/setup.ts` copies raw TypeScript; OpenClaw plugin system may expect JavaScript. |

### Deferred to Future Phases

| Item | Phase | Notes |
|------|-------|-------|
| Dashboard authentication (JWT/API key) | Phase 2 | Required before multi-tenant deployment |
| NLP/ML-based content classification | Phase 3+ | Regex catches ~5% of enterprise-sensitive data. Financial projections, HR data, trade secrets, M&A materials, legal communications need ML. |
| Enterprise DLP integration (Nightfall, Lakera) | Phase 3+ | For customers with existing DLP infrastructure |
| Real-time model health monitoring / failover | Phase 2 | Local model down can cascade PII to cloud |
| Multi-language PII patterns | Phase 3+ | English/US patterns only for now |
| Kubernetes Helm chart deployment | Phase 4 | Currently Docker Compose only |
| Multi-tenant control plane | Phase 4 | Single dashboard per deployment currently |
| Agent marketplace | Phase 4 | Create and share custom role templates |

---

## Key Sources

- [MIT: 95% of GenAI Pilots Failing](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/)
- [Gartner Geopatriation Trends](https://www.truefoundry.com/blog/geopatriation)
- [Agentic AI ROI Stats 2026](https://onereach.ai/blog/agentic-ai-adoption-rates-roi-market-trends/)
- [2026 Guide to SaaS & Agentic Pricing](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models)
- [Chargebee: Pricing AI Agents Playbook](https://www.chargebee.com/blog/pricing-ai-agents-playbook/)
- [Outcome-Based Pricing (Sierra)](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents)
- [SOC 2 Certification Cost 2026](https://www.brightdefense.com/resources/soc-2-certification-cost/)
- [SOC 2 Timeline 2026](https://soc2auditors.org/insights/soc-2-timeline/)
- [Local LLM Cost Savings](https://medium.com/@knikhilreddy99/how-i-built-my-own-custom-llm-with-ollama-and-saved-50-000-in-cloud-ai-costs-a64874339659)
- [Ollama vs vLLM Benchmarks 2026](https://like2byte.com/ollama-vs-vllm-local-benchmarks-2026/)
- [Calacanis Investment Thesis](https://www.capitaly.vc/blog/jason-calacanis-investment-thesis-check-sizes-red-flags-2025-guide)
- [All-In CES 2026](https://www.twice.com/industry/ces/ces-2026-all-in-podcast-at-ces-on-ai-fundamentally-reshaping-investment-strategy-ma-and-hiring)
- [A16Z: Enterprise AI Builders](https://a16z.com/insights-for-enterprise-ai-builders/)
- [Deloitte: SaaS Meets AI Agents](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/saas-ai-agents.html)
- [OpenClaw Enterprise Deployment Guide](https://eastondev.com/blog/en/posts/ai/20260205-openclaw-enterprise-deploy/)
- [Proofpoint Acquires Acuvity](https://www.proofpoint.com/us/newsroom/press-releases/proofpoint-acquires-acuvity-deliver-ai-security-and-governance-across)
- [Portkey AI Gateway](https://portkey.ai/features/ai-gateway)
- [Nightfall AI DLP](https://www.nightfall.ai/)
