# Clawforce: Enterprise AI Workforce Platform

**Date**: 2026-02-14
**Status**: Pre-MVP Research & Planning
**Built On**: OpenClaw (open-source personal AI assistant)

---

## Executive Summary

Clawforce is a managed platform that deploys, monitors, and bills autonomous AI agents ("AI employees") into enterprise infrastructure. Built on top of the open-source OpenClaw project, the platform solves the #1 blocker to enterprise AI adoption: **data security and compliance**.

**One-liner**: Deploy AI employees on your infrastructure. Your data never leaves.

**Positioning**: Beam AI automates your known workflows. **We handle the work that requires thinking.**

---

## The Problem

- **95% of enterprise AI pilots fail** (MIT, 2025) -- #1 reason: data security and compliance
- Companies choosing between "use AI unsecurely" or "don't use AI at all"
- Regulated industries (finance, healthcare, legal, government) locked out entirely
- Existing solutions are either security-only (can't execute), execution-capable (cloud-only), or self-hosted (can't do real work)

---

## Competitive Landscape

### What Exists Today

| Company | What They Do | What They Don't Do |
|---|---|---|
| **Portkey** | Routes LLM API calls, cost tracking, guardrails | Can't execute tasks, no agents |
| **Nightfall / Lakera** | DLP -- blocks data leakage to AI | Doesn't provide AI, just blocks it |
| **Beam AI** ($4.5M rev, SOC 2) | SOP-driven workflow automation, 1500+ API integrations | Follows pre-defined flows, can't reason autonomously |
| **Dify / Langflow** | Open-source visual workflow builders, self-hostable | Limited execution, no browser automation, no multi-channel |
| **Lindy** | Pre-built AI agents for business tasks | Cloud-only, no data sovereignty |

### The Gap

```
                        CAN REASON AUTONOMOUSLY
                        (browse, improvise, judge)
                              |
                    NO        |         YES
                              |
    SELF-HOSTED   ----------- + ------------------
    (data stays   Dify        |   CLAWFORCE
     on-prem)     Langflow    |   (THIS IS THE GAP)
                              |
    CLOUD-ONLY   ------------ + ------------------
    (data goes    Beam AI     |   Nothing
     to vendor)   Portkey     |
```

### Beam AI Deep Dive (Primary Competitor)

**Their strengths (we borrow these)**:
- Three automation modes: fully autonomous / human-in-the-loop / hybrid
- Centralized approval inbox with audit trail
- Three-layer accuracy tracking (workflow / step / variable level)
- Self-learning feedback loop (corrections improve the agent)
- Visual flow builder for non-technical users
- SOC 2 Type II + ISO 27001 + GDPR certified
- Fortune 500 customers, $4.5M revenue (2025)

**Their weaknesses (our differentiation)**:
- Agents follow **pre-defined SOP flows** -- can't reason about novel situations
- 1,500 integrations are **API-to-API** -- useless for legacy tools without APIs
- Not a **conversational presence** in your channels -- it's a backend engine
- No **per-request model routing** based on data sensitivity
- On-premise option exists but model routing is opaque

### Our Actual Differentiators

| | Beam AI | Clawforce |
|---|---|---|
| Agent type | Workflow executor (follows SOPs) | Autonomous reasoner (figures things out) |
| Task scope | Known, repeatable processes | Unknown, judgment-required tasks |
| Integration model | 1,500 API connectors | Browser automation (works with ANY web tool) |
| User interaction | Dashboard/config UI | Natural language in your messaging channels |
| Data routing | On-prem option, opaque | Per-request sensitivity + cost routing |
| Target buyer | Process automation teams (COO) | Knowledge workers + leadership (CTO/CEO) |

---

## Unit Economics

| | Human Employee | Clawforce AI Employee |
|---|---|---|
| Monthly cost | $8K-15K (fully loaded) | $1K-2.5K (with model routing) |
| Hours/day | 8 | 24 |
| Onboarding | 2-4 weeks | 5 minutes |
| Scales | Hire more people | Deploy more agents |

**Model routing cost impact**: Drops $300/day (all cloud) to $50-80/day by routing 70-80% of requests to local Ollama.

### Pricing Model (Hybrid)
```
Base Platform Fee:        $2,000/month   (deployment, dashboard, compliance, support)
Per AI Employee:          $500-2,000/month (role complexity + model usage)
Cloud Model Pass-through: Cost + 20% margin (only for cloud API calls)
```

---

## What OpenClaw Already Provides (Don't Build)

| Capability | Enterprise Value |
|---|---|
| Docker deployment (non-root, health checks) | Kubernetes-ready |
| Multi-agent routing (8-tier priority bindings) | Department isolation |
| Sandbox mode (per-session Docker containers) | Security isolation |
| Model failover + auth rotation + Ollama native support | Cost optimization + resilience |
| 20+ channel connectors (Slack, Teams, WhatsApp, etc.) | Meet workers where they are |
| Browser automation (Playwright) | Works with ANY web tool |
| Cron scheduling + webhooks | Background automation |
| Skills system (SKILL.md files) | Teachable agents |
| Hooks system (event-driven TypeScript handlers) | Compliance logging, approval workflows |
| Security audit CLI | Automated compliance checks |

---

## What We Build (The Platform Layer)

```
+----------------------------------------------------------+
|                    CLAWFORCE PLATFORM                     |
|                                                           |
|  +--------------+  +---------------+  +-----------------+ |
|  | Deploy       |  | Monitor /     |  | Compliance      | |
|  | Manager      |  | ROI Dashboard |  | Logger          | |
|  +--------------+  +---------------+  +-----------------+ |
|  +--------------+  +---------------+  +-----------------+ |
|  | Agent Role   |  | Model Router  |  | Approval        | |
|  | Templates    |  | (cost+sec)    |  | Workflow        | |
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
**Goal**: Deployable single-agent system with approval workflow

**Build**:
1. **Deployment script** (`clawforce deploy`) -- Docker Compose wrapper that:
   - Generates `openclaw.json` from a simple `clawforce.yaml`
   - Starts OpenClaw gateway + Ollama sidecar containers
   - Pre-populates workspace with agent role template
   - Skips interactive onboarding

2. **3 Agent Role Templates** (SKILL.md + config bundles):
   - **Inbox Analyst**: monitors Slack, summarizes threads, flags action items, daily briefings
   - **Research Agent**: takes requests via Slack, browses web, compiles reports
   - **Process Automator**: cron-triggered browser workflows, reports results

3. **Human-in-the-loop approval mode** (borrowed from Beam):
   - Agent posts proposed actions to a dedicated Slack approval channel
   - Human reacts to approve/reject
   - Agent proceeds or aborts based on response
   - All decisions logged for audit trail

4. **Compliance logger hook**:
   - Captures every tool execution, model call, and channel message
   - Append-only JSONL audit log
   - Built as an OpenClaw hook (PostToolUse events)

**Deliverable**: `clawforce deploy --config clawforce.yaml` -> working AI employee in 5 minutes.

See: **[phase-0-implementation.md](./phase-0-implementation.md)** for full technical details.

---

### Phase 1: The Demo That Sells (Weeks 3-5) -- IMPLEMENTED
**Goal**: Live demo for design partners and investors

**What's Built**:

#### 5-Dimensional Model Router
Intelligent per-request routing across 5 dimensions with configurable priority ordering.
- **PII Detection**: Regex-based scanning for SSN, credit cards, emails, phone numbers + configurable keyword blocklist
- **Complexity Analysis**: Heuristic scoring (word count, code blocks, multi-step markers, domain keywords)
- **Domain Detection**: Classifies prompts into code, writing, analysis, data, or conversation for specialized model routing
- **Budget Tracking**: Daily spend limits with persistent state, automatic fallback to cheaper models when over budget
- **Configurable Priority**: Choose evaluation order (e.g., sensitivity > cost > domain > complexity)
- Deployed as an OpenClaw plugin via `before_agent_start` hook

```yaml
# clawforce.yaml
router:
  enabled: true
  rules:
    - condition: "pii_detected"
      model: "ollama/llama3.3:8b"
    - condition: "low_complexity"
      model: "ollama/llama3.3:8b"
    - condition: "high_complexity"
      model: "anthropic/claude-sonnet-4-5"
    - condition: "domain_code"
      model: "openai/gpt-4o"
    - condition: "domain_writing"
      model: "anthropic/claude-sonnet-4-5"
    - condition: "over_budget"
      model: "ollama/llama3.3:8b"
  sensitivity_keywords: ["password", "secret"]
  priority: ["sensitivity", "cost", "domain", "complexity"]
  budget:
    daily_limit: 10.00
    fallback_model: "ollama/llama3.3:8b"
```

#### Route Test CLI
Test routing decisions before deploying:
```bash
clawforce route-test "fix this TypeScript bug" -c clawforce.yaml
# Model: openai/gpt-4o
# Reason: Domain "code" — routing to specialized model
# Dimensions:
#   PII: no
#   Complexity: low
#   Domain: code (confidence: 0.14)
#   Budget: $0.00/$10.00 remaining
```

#### Compliance Logger Plugin
Structured JSONL logging of all agent activity via OpenClaw hooks.
- Captures `tool_call`, `message_received`, `message_sent`, and `routing_decision` events
- Queryable via `clawforce audit --source compliance`
- Machine-readable format for dashboard consumption

```yaml
compliance:
  enabled: true
```

#### Activity Dashboard
4-panel Next.js dashboard with real-time streaming and interactive cost analysis.
- **Agent Status**: Container health, uptime, running state
- **Activity Feed**: Real-time SSE streaming from compliance log (with polling fallback)
- **Cost Tracker**: Tabbed interface with Summary, Timeline (hourly bar chart), and What-If analysis
- **Task Log**: Recent agent runs with duration and outcome
- Runs as a separate Docker container, reads from shared volumes (read-only)

```yaml
dashboard:
  enabled: true
  port: 3000
```

#### GPU Support for Ollama
```yaml
ollama:
  enabled: true
  model: "llama3.3:8b"
  gpu: nvidia  # or "amd" or "none"
```

#### Capability Profiles & OpenClaw Passthrough
Preset tool configurations and direct access to all OpenClaw capabilities:
```yaml
capabilities: full  # "minimal" | "standard" | "full"

# Or fine-tune with direct passthrough:
openclaw:
  agents:
    defaults:
      tools:
        sandbox: { enabled: true }
        browser: { enabled: true, headless: true }
```

#### Audit Command
View compliance logs from the CLI:
```bash
clawforce audit                      # Container logs (default)
clawforce audit --source compliance  # Structured compliance log
clawforce audit -n 100               # Last 100 entries
```

**Demo script (5 min)**:
1. `clawforce deploy -c demo.yaml` -> gateway + dashboard containers start
2. Open `http://localhost:3000` -> 4-panel dashboard with SSE streaming
3. Send "what's the weather?" -> routed to local model (low complexity, cost-efficient)
4. Send "my SSN is 123-45-6789" -> routed to local model (PII detected)
5. Send "fix this TypeScript bug" -> routed to code-specialized model (domain detection)
6. Show dashboard: cost timeline, what-if analysis, real-time activity stream
7. Show compliance log: every action captured as structured JSONL
8. `clawforce route-test "analyze quarterly revenue trends"` -> shows all 5 routing dimensions
9. "All data stayed on this machine. 60%+ of requests used a free local model."

---

### Phase 2: Design Partner Pilot (Weeks 6-12)
**Goal**: 2-3 companies running it for real

**Build**:
1. **Enterprise onboarding wizard** (infra check, channel connect, role select, security policy, test run)
2. **Expanded template library** (8-10 roles: meeting prep, invoice processor, compliance monitor, customer response drafter, report generator)
3. **Multi-agent management** (multiple AI employees per deployment, shared channel connections)
4. **Self-learning feedback loop** (borrowed from Beam): corrections feed back into SKILL.md updates, agent improves over time
5. **Alert system** (errors, cost budget, sensitive data detection, idle agents)

**Pilot structure**: 8-12 weeks free, weekly reviews, defined success criteria, week 8 go/no-go.

---

### Phase 3: Monetize (Weeks 13-20)
**Goal**: First paying customers, $10K+ MRR

**Build**:
1. **Billing engine** (base fee + per-agent + cloud pass-through)
2. **SOC 2 Type I** ($25-40K, 4-8 weeks fast-track)
3. **Customer success playbook** (standardized onboarding, weekly ROI reports, QBR templates)

---

### Phase 4: Scale Prep (Weeks 21-30)
**Goal**: Seed fundraise ready

- Kubernetes deployment (Helm chart)
- Multi-tenant control plane
- Visual flow builder (borrowed from Beam -- Phase 4, not MVP)
- Agent template marketplace
- Case studies with real numbers

---

## Timeline & Budget

| Phase | Duration | Cost | Milestone |
|---|---|---|---|
| Phase 0: Foundation | 2 weeks | $0 (your time) | Deployable system + approval workflow |
| Phase 1: Demo | 3 weeks | ~$500/month (API costs) | Live investor/partner demo |
| Phase 2: Pilot | 6 weeks | ~$2K/month (infra) | 2-3 design partners |
| Phase 3: Monetize | 8 weeks | ~$30K (SOC 2) + $2K/month | $10K+ MRR |
| Phase 4: Scale | 10 weeks | Variable | Seed fundraise |

**Total to first revenue**: ~4-5 months, ~$35-40K (mostly SOC 2).

---

## The Moat

1. **Data gravity**: Once deployed in customer VPC with system access, switching costs are enormous
2. **Model routing intelligence**: Proprietary data on cost vs sensitivity optimization
3. **Compliance certifications**: SOC 2, HIPAA, FedRAMP -- expensive barriers
4. **Self-learning feedback data**: Agent improvements compound across customer base
5. **Browser automation advantage**: Works with ANY tool (no API needed) -- competitors need 1,500 integrations, we need zero

---

## Investor Thesis (Calacanis Fit)

- **"Domain-specific copilots on proprietary data"** -- AI employees trained on company workflows
- **"AI-enabled services, high gross margins"** -- Replacing $12K/month humans with $2K/month agents
- **"Default alive"** -- 5-10 customers at $50K+/year covers costs
- **"Chase the problem, not the buzzword"** -- Real problem: enterprises can't use AI safely
- **"AI-native"** -- Built from ground up on autonomous agent runtime, not retrofitted

---

## Immediate Next Steps (This Week)

1. Stand up OpenClaw instance with Docker + Ollama sidecar
2. Write first Agent Role Template (Inbox Analyst SKILL.md)
3. Build the approval workflow hook
4. Connect to own Slack and dogfood for a week
5. Identify 3-5 potential design partners (100-500 employees, regulated industries)

---

## Future Expansion

- **Competitive Intelligence**: Always-on market monitoring ($5K-25K/month)
- **AI Sales Development**: Prospect research + outreach ($2K-5K/month per seat)
- **Executive Decision Support**: Briefings + meeting prep ($5K-50K/month)
- **Customer Operations**: Multi-channel support with real resolution ($0.50-5/ticket)
- **Compliance Monitoring**: Regulatory tracking for regulated industries ($10K-100K/month)

---

## Key Sources

- [MIT: 95% of GenAI Pilots Failing](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/)
- [Gartner Geopatriation Trends](https://www.truefoundry.com/blog/geopatriation)
- [Beam AI Architecture](https://beam.ai/agentic-insights/the-beam-ai-stack-a-comprehensive-architecture-for-enterprise-ai-agents)
- [Beam AI Self-Learning Agents](https://beam.ai/agentic-insights/from-large-language-models-to-self-learning-enterprise-ai-agents)
- [Beam AI Revenue ($4.5M)](https://getlatka.com/companies/beam.ai)
- [2026 Guide to Agentic Pricing](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models)
- [Chargebee: Pricing AI Agents](https://www.chargebee.com/blog/pricing-ai-agents-playbook/)
- [SOC 2 Cost 2026](https://www.brightdefense.com/resources/soc-2-certification-cost/)
- [Local LLM Cost Savings](https://medium.com/@knikhilreddy99/how-i-built-my-own-custom-llm-with-ollama-and-saved-50-000-in-cloud-ai-costs-a64874339659)
- [Calacanis Investment Thesis](https://www.capitaly.vc/blog/jason-calacanis-investment-thesis-check-sizes-red-flags-2025-guide)
- [A16Z: Enterprise AI Builders](https://a16z.com/insights-for-enterprise-ai-builders/)
- [OpenClaw Enterprise Deployment](https://eastondev.com/blog/en/posts/ai/20260205-openclaw-enterprise-deploy/)
