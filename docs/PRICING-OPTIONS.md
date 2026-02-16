# Clawforce: Pricing & Monetization Options

**Date**: 2026-02-16
**Status**: Internal analysis — pre-Phase 3

---

## What We Control

Clawforce sits between the customer's infrastructure and the underlying AI stack:

```
Customer's Infrastructure (channels, tools, data)
    |
[Clawforce] <-- we control this layer
    |
[OpenClaw]  <-- open source, free
    |
[LLM Providers] <-- Anthropic/OpenAI/Google charge per token
```

We don't own the models. We don't own the runtime. We own the **orchestration, security, compliance, and management layer**. That's what we price.

---

## Value Anchors (What Justifies the Price)

| Value | How to Quantify |
|-------|----------------|
| **Cost savings** | "Our router saved you 65% on AI costs by routing simple tasks to local models" |
| **Security** | "PII never left your network. Zero cloud exposure incidents." |
| **Compliance** | "Full audit trail for SOC 2 / HIPAA. Here's your report." |
| **Time savings** | "Your inbox agent processed 2,400 emails this month. That's ~120 analyst hours." |
| **Coordination** | "3 agents working together, supervised by Ultron, zero human intervention needed." |

The ROI calculator (Phase 3.2) is designed to generate these numbers automatically per deployment.

---

## The API Key Question

Clawforce already supports two credential modes via `credential_mode` in `clawforce.yaml`:

| Mode | How It Works | Who Pays for Tokens |
|------|-------------|-------------------|
| `env` | Customer puts their `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `.env` | Customer pays provider directly |
| `auth_profile` | Uses OpenClaw's built-in auth profile rotation with multiple keys | Customer pays provider directly |
| **Future: `managed`** | Clawforce provides API access, bills customer at markup | We pay provider, bill customer |

**Default recommendation**: Let customers use their own keys (`env` mode). This removes pricing friction, builds trust, and strengthens the data sovereignty pitch ("your keys, your data, your network"). The `managed` mode is a Phase 3+ add-on for customers who want single-vendor billing simplicity.

---

## Pricing Models

### Option 1: Platform SaaS (Managed Service)

We host and manage everything. Customer gets a dashboard URL and connects their channels.

| Tier | Monthly Price | Includes |
|------|--------------|----------|
| Starter | $500 | 3 agents, 1M tokens/mo included, basic templates |
| Business | $2,000 | 10 agents, 5M tokens/mo included, all templates, priority support |
| Enterprise | Custom | Unlimited agents, dedicated infra, SLA, custom compliance profiles |

**Token overage**: Cloud model usage beyond included tokens billed at cost + 20-30% margin. Local model usage is "free" (customer's GPU or our managed GPU at flat rate).

**Pros**: Highest revenue per customer, sticky (they depend on our infrastructure), predictable revenue.

**Cons**: We eat infrastructure costs, need ops team, harder to start, raises data sovereignty concerns for regulated industries.

**Best for**: SMBs who want turnkey AI without managing infrastructure.

---

### Option 2: Self-Hosted License (Enterprise Software)

Customer deploys Clawforce on their own infrastructure. We sell the software license + support.

| Tier | Monthly Price | Includes |
|------|--------------|----------|
| Team | $200 | Up to 5 agents, community templates, email support |
| Business | $1,000 | Up to 25 agents, all templates, Slack support, dashboard |
| Enterprise | $5,000+ | Unlimited agents, custom templates, dedicated support, compliance profiles, SOC 2 docs |

**Customer plugs in their own API keys.** We never touch their tokens or see their data.

**Pros**: No infrastructure costs for us, aligns with data sovereignty pitch, scales with customer size, strongest story for regulated industries.

**Cons**: Lower revenue per customer than managed, harder to enforce usage limits, support burden without access to their environment.

**Best for**: Regulated industries (finance, healthcare, legal) where data sovereignty is non-negotiable.

---

### Option 3: Open Core + Commercial Add-ons

Core Clawforce is free/open source. Premium features are paid.

| Free (Open Source) | Paid |
|---|---|
| Single agent deploy | Multi-agent orchestration (Ultron pattern) |
| Basic routing (2 dimensions) | Full 5-dimension router |
| JSONL compliance logs | SQLite + dashboard + RBAC |
| 3 role templates | Full template library (10+) |
| Community support | Priority support + SLA |
| --- | Compliance profiles (HIPAA, PCI-DSS, GDPR, CCPA, SOX) |
| --- | Enterprise integrations (Google Workspace, Notion, Jira) |
| --- | SOC 2 compliance documentation |

**Pros**: Builds community, reduces sales friction, wide top of funnel, developers try for free and advocate internally.

**Cons**: Hard to draw the free/paid line, risk of "good enough" free tier, community maintenance overhead.

**Best for**: Developer-led adoption, bottom-up sales motion.

---

### Option 4: Usage-Based (Pay Per Agent-Hour or Per Task)

Charge based on actual usage, not seats or tiers.

| Metric | Price Range |
|--------|------------|
| Per agent-hour | $0.50 - $2.00/hr per active agent |
| Per task completed | $0.10 - $1.00 per task (varies by complexity) |
| Per token routed | Cost + 15-25% margin on cloud tokens |
| Local model compute | $0.10 - $0.50/hr GPU time (if we provide infrastructure) |

**Pros**: Low barrier to entry, scales naturally, customers pay for value delivered.

**Cons**: Unpredictable revenue, complex metering infrastructure needed, customers may try to minimize usage.

**Best for**: Variable workloads, customers who want to start small and scale.

---

### Option 5: Hybrid Model (Recommended)

Self-hosted license with usage-based cloud model pass-through option.

```
Monthly Platform Fee (per deployment)
  + Per-Agent Fee (scales with workforce size)
  + Cloud Token Pass-Through (optional: cost + margin, OR customer's own keys)
```

| Component | Starter | Business | Enterprise |
|-----------|---------|----------|------------|
| **Platform fee** | $300/mo | $1,500/mo | Custom |
| **Per agent** | $50/agent/mo | $100/agent/mo | Negotiated |
| **Agents included** | 3 | 10 | Unlimited |
| **Cloud tokens** | Customer's keys | Customer's keys OR pass-through at cost+20% | Flexible |
| **Templates** | 5 | All | All + custom |
| **Support** | Email | Slack + email | Dedicated |
| **Compliance** | Basic audit trail | Full profiles (HIPAA, PCI-DSS, etc.) | Full + SOC 2 docs |
| **Dashboard** | Read-only | Full RBAC | Full + SSO integration |

**Why this model works**:

1. **Platform fee** covers core value: orchestration, routing, compliance, security — regardless of token volume
2. **Per-agent fee** scales naturally — if customers are getting value, they add more agents
3. **Customer's own API keys** is the default — removes "are you marking up our AI costs?" objection
4. **Pass-through option** exists for customers who want one vendor/one bill simplicity
5. **Compliance profiles** and **SOC 2 docs** justify enterprise pricing — regulated industries will pay premium

**Revenue example**:
- Customer with 5 agents on Business tier: $1,500 + (5 x $100) = **$2,000/mo**
- Customer with 15 agents on Enterprise: $5,000 + (15 x $150) = **$7,250/mo**
- 10 customers at blended $3,000/mo = **$360K ARR**

---

## Recommended Rollout Strategy

### Phase 1: Pilot (Now - Post 2B)
- **Price**: Free
- **Goal**: Prove value, gather case studies, refine the product
- **Metric**: 2-3 design partners running 3+ agents each
- **Output**: Documented cost savings, time savings, and compliance metrics per deployment

### Phase 2: Early Pricing (Post 2C)
- **Price**: $1,000 - $2,000/mo flat fee for up to 10 agents
- **Model**: Simple flat rate, customer's own API keys, no usage metering
- **Goal**: Validate willingness to pay, find price sensitivity
- **Avoid**: Complex metering or token billing — too early, too much infrastructure

### Phase 3: Mature Pricing (Phase 3+)
- **Price**: Full hybrid model (platform fee + per-agent + optional pass-through)
- **Model**: Usage metering, billing engine, Stripe integration, ROI reports
- **Goal**: Scalable revenue, automated billing, enterprise contracts
- **Add**: SOC 2 documentation as enterprise upsell

---

## Competitive Positioning

| Feature | Clawforce | Generic AI Wrapper | Direct OpenClaw |
|---------|-----------|-------------------|----------------|
| Multi-agent orchestration | Built-in (Ultron) | Manual | Manual |
| PII routing enforcement | 3-layer defense in depth | None | None |
| Model cost optimization | 5-dimension router | None | Manual config |
| Compliance audit trail | Dual-write + framework profiles | None | None |
| Data sovereignty | Enforced by architecture | Varies | Self-hosted |
| Enterprise dashboard | RBAC, SSE, multi-agent | None | Basic UI |
| Time to deploy | `clawforce deploy` | Custom dev work | `openclaw gateway` |
| Ongoing management | Dashboard + CLI + alerts | Custom | Manual |

**The pitch**: "OpenClaw is the engine. Clawforce is the enterprise vehicle — security, compliance, cost intelligence, and workforce coordination included."

---

## What NOT to Charge For

- **OpenClaw itself** — it's open source, and our value is the layer on top
- **Basic single-agent deployment** — keep the barrier to entry low (or consider open-core)
- **Model API access** — we're not a model provider, don't try to be one (unless offering managed pass-through)
- **Per-seat pricing** — agents serve the whole org, not individual users

---

## Technical Requirements for Billing (Phase 3)

To implement the hybrid model, the billing engine needs:

1. **Usage metering** — token-level tracking per agent, per model, per day (extends existing `StorageWriter`)
2. **Billing calculation** — platform fee + per-agent fee + optional token pass-through with margin
3. **Invoice generation** — PDF/HTML invoices with breakdown
4. **ROI calculator** — automated weekly reports: tasks completed, tokens processed, cost savings vs human equivalent
5. **Stripe integration** — automated billing and payment collection (stretch goal)
6. **Usage dashboard** — drill-down by agent, model, day, cost category

The existing SQLite storage layer, `BudgetTracker`, and `StorageReader` provide the foundation. The billing engine adds aggregation, calculation, and presentation on top.

---

## Open Questions

1. **Open core vs. closed source?** — Do we open-source the base and charge for enterprise features, or keep everything proprietary? Open core drives adoption but limits revenue per customer.
2. **Annual contracts?** — Enterprise customers often prefer annual contracts with a discount (e.g., 2 months free). When do we introduce these?
3. **Partner/reseller model?** — Could consultancies or MSPs resell Clawforce deployments? What's the margin structure?
4. **GPU-as-a-service?** — Should we offer managed GPU infrastructure for local model inference alongside the platform? Or stay software-only?
5. **Per-deployment vs. per-org pricing?** — Does a customer with 3 separate deployments (dev/staging/prod) pay 3x? Or is it per-org with unlimited deployments?
