# Research: 2B.2 Supervisor Agent Template (Ultron)

**Date**: 2026-02-16  
**Area**: Clawforce multi-agent orchestration and OpenClaw compatibility

## Research Question

What is required to add a supervisor-first agent template ("Ultron") that can monitor sub-agents, answer workforce status questions, and integrate with the existing Clawforce dashboard while staying compatible with OpenClaw?

## Summary

Clawforce already has most of the data model needed for a supervisor agent:

- Per-agent observability is already persisted in SQLite (`agent_id` across compliance, routing, budgets, alerts).
- `StorageReader` already exposes agent-filtered queries suitable for supervisor workflows.
- Multi-agent config already supports `supervises`.

The missing pieces are mainly product wiring:

1. Supervisors are now identified by having a `supervises` field (no separate role needed).
2. Add a supervisor tool (`clawforce_workforce_status`) backed by `StorageReader`.
3. Scope dashboard APIs to `agentId` for supervisor-focused ingestion and UI filtering.
4. Add compatibility guardrails so generated config remains stable across OpenClaw versions.

## Current State Analysis

### Config and agent setup

- Agents use `workspace` (a path to the user's OpenClaw workspace directory) instead of a `role` enum.
- `supervises` is already present in agent schema and validated for existence/non-self supervision. Having `supervises` makes an agent a supervisor.
- OpenClaw passthrough config exists through `openclaw` in `clawforce.yaml`.

Relevant files:
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`

### Observability and status data

- SQLite schema already includes `agent_id` and indexes in:
  - `compliance_events`
  - `routing_decisions`
  - `usage_metrics`
  - `budget_state`
  - `alerts`
- Reader APIs already support agent filtering for events, routing, and usage.

Relevant files:
- `src/storage/migrations.ts`
- `src/storage/writer.ts`
- `src/storage/reader.ts`

### Dashboard ingestion

- Dashboard activity API currently filters by event, but not by `agentId`.
- Streaming pipeline already emits activity/cost/status/alerts, but does not expose agent-scoped query controls end-to-end.

Relevant files:
- `clawforce-dashboard/src/app/api/activity/route.ts`
- `clawforce-dashboard/src/app/api/activity/stream/route.ts`
- `clawforce-dashboard/src/lib/activity-poller.ts`

### OpenClaw integration posture

- Clawforce generates OpenClaw config and plugin entries, then deep-merges `openclaw` passthrough config.
- Bindings schema is ported from OpenClaw schema and validated locally.
- Multi-agent bindings currently pick the first configured connector for channel assignments.

Relevant files:
- `src/config/generate-openclaw.ts`
- `src/plugins/manifest-schema.ts`

## Desired End State

Ultron is a first-class supervisor capability (triggered by having `supervises`) that can:

- Monitor supervised agents for activity, errors, budget health, and anomalies.
- Answer workforce status questions from ops channels in near real-time.
- Escalate failures and policy risks to humans with clear context.
- Feed a dashboard that supports both aggregate and per-agent views.

## Proposed System Design

### 1) Supervisor workspace setup

Supervisors are identified by having a `supervises` field. Users manage their own workspace contents (SOUL.md, SKILL.md, etc.). The supervisor workspace should include:

Supervisor behavior:

- Monitoring loop (recent events + alerts + budgets)
- Status query handling ("what is the workforce doing now?")
- Escalation policy (model down, budget exhausted, PII/security alert, prolonged idle)
- Workload balancing suggestions (non-blocking recommendations first)

### 2) Supervisor status tool

Add a tool layer backed by `StorageReader`:

- `src/tools/supervisor-status.ts`

Primary operations:

- `getAgentActivity(agentIds, since, event?, limit?)`
- `getAgentBudgets(agentIds)`
- `getAgentAlerts(agentIds, since, severity?, unacknowledgedOnly?)`
- `getWorkforceMetrics(agentIds, days)`

Important constraint:

- Agent scope must be restricted to the caller's configured `supervises` list.  
  Supervisor must not query arbitrary agents unless explicitly authorized.

### 3) Config and generation changes

- Supervisors are identified by the `supervises` field on the agent config (no role enum needed).
- In `generate-openclaw`, merge tool definition for agents with `supervises` into generated config.
- Each agent's workspace is mounted individually into the Docker container.

### 4) Dashboard readiness

For supervisor and ops visibility, add `agentId` filtering support in dashboard APIs:

- Activity API: `GET /api/activity?agentId=<id>&event=<event>&limit=<n>`
- Stream API: preserve agentId in event payloads and add agent filter support where practical.
- Cost API: aggregate from per-agent routing decisions if gateway aggregate is insufficient.

## OpenClaw Compatibility Requirements

### Contract guardrails

1. Keep bindings schema aligned with OpenClaw (`zod-schema.agents` equivalent).
2. Keep plugin manifest compatibility (`openclaw.plugin.json`) validated for required fields.
3. Keep hook naming and return shape stable (`before_agent_start`, `agent_end`, etc.).

### Practical safeguards

- Add integration tests that run against a real OpenClaw container image.
- Track tested OpenClaw versions in docs.
- Fail fast with actionable errors when generated config violates OpenClaw schema.

## Phased Implementation Plan

## Overview

Implement Ultron in six phases, each with explicit verification gates and no behavior regressions for existing single-agent or multi-agent setups.

## What We're NOT Doing

- Building a separate orchestration service outside OpenClaw.
- Implementing autonomous task reassignment on day one (recommendation mode first).
- Introducing cross-workspace federation or multi-cluster workforce management.
- Replacing existing router/compliance plugins.

## Phase 1: Enable Supervisor via `supervises` Field

### Changes Required

**Files**:
- `src/config/types.ts`

### Success Criteria

#### Automated Verification
- [ ] Config parser accepts agents with `supervises` field (making them supervisors).
- [ ] Existing configs remain valid.

#### Manual Verification
- [ ] `clawforce deploy` works with a supervisor agent (one with `supervises`) in `agents[]`.

## Phase 2: Implement Supervisor Tool

### Changes Required

**Files**:
- `src/tools/supervisor-status.ts` (new)
- `src/storage/reader.ts` (only if helper extensions are needed)
- Tool registration path in generated OpenClaw config

### Success Criteria

#### Automated Verification
- [ ] Tool returns scoped data for configured supervised agents.
- [ ] Unauthorized agent queries are rejected.
- [ ] Empty result handling is stable (no crashes/null misuse).

#### Manual Verification
- [ ] Supervisor answers a live status query with current agent health context.

## Phase 3: Dashboard Agent Filters

### Changes Required

**Files**:
- `clawforce-dashboard/src/app/api/activity/route.ts`
- `clawforce-dashboard/src/app/api/activity/stream/route.ts`
- `clawforce-dashboard/src/lib/activity-poller.ts`

### Success Criteria

#### Automated Verification
- [ ] `agentId` query filter returns scoped events.
- [ ] Existing unfiltered behavior remains unchanged.

#### Manual Verification
- [ ] Dashboard can pivot between All Agents and single-agent activity.

## Phase 4: OpenClaw Compatibility Hardening

### Changes Required

**Files**:
- `src/plugins/manifest-schema.ts`
- Integration test suite additions

### Success Criteria

#### Automated Verification
- [ ] Generated bindings pass compatibility tests for supported OpenClaw versions.
- [ ] Plugin manifest validation fails clearly on contract drift.

#### Manual Verification
- [ ] End-to-end deploy starts cleanly against target OpenClaw image.

## Phase 5: Alerting and Escalation Rules

### Changes Required

**Files**:
- Supervisor skill guidance and optional escalation thresholds in config
- Existing alert ingestion paths (no schema breakage)

### Success Criteria

#### Automated Verification
- [ ] Escalation triggers on synthetic model-down/budget/PII events.

#### Manual Verification
- [ ] Human-readable escalation messages appear in expected channel/dashboard context.

## Phase 6: Documentation and Operational Playbook

### Changes Required

**Files**:
- `docs/MULTI-AGENT.md`
- `docs/GETTING_STARTED.md`
- `docs/INFRASTRUCTURE-DEPLOYMENT.md`

### Success Criteria

#### Automated Verification
- [ ] Docs examples validate against current config schema.

#### Manual Verification
- [ ] New user can configure and run Ultron from docs alone.

## Risks and Mitigations

- **Schema drift with OpenClaw**
  - Mitigation: compatibility tests and explicit supported version matrix.
- **Supervisor overreach into unsupervised agents**
  - Mitigation: strict allowlist via `supervises` mapping and runtime authorization checks.
- **Dashboard query load spikes**
  - Mitigation: indexed agent filters and capped limits with sane defaults.
- **Cost ambiguity per agent**
  - Mitigation: derive per-agent usage from `routing_decisions` first; reconcile with gateway totals.

## Validation Strategy

### Automated

- Unit tests for config parsing and supervisor validation.
- Unit tests for supervisor tool query logic and auth scoping.
- API tests for `agentId` filtering in activity endpoints.
- Integration test for deploy + status query using OpenClaw container.

### Manual

- Run multi-agent deployment with one supervisor and at least two worker agents.
- Trigger representative events (success, failure, budget pressure, policy event).
- Validate supervisor responses and dashboard consistency.

## Recommended First Slice

Implement Phases 1 and 2 together first:

1. Supervisors identified by `supervises` field (no role enum needed).
2. Add `clawforce_workforce_status` with strict supervised-agent scoping.

This yields immediate value (status and oversight) with minimal infrastructure risk, and sets up dashboard improvements as a subsequent slice.
