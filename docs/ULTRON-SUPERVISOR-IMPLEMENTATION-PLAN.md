# Ultron Supervisor Implementation Plan

## Overview

This plan implements `2B.2 Supervisor Agent Template (Ultron)` as a first-class Clawforce capability that:

- identifies supervisors via the `supervises` field (no role enum needed),
- provides a scoped workforce-status tool for supervisor agents,
- keeps OpenClaw interoperability stable,
- and prepares dashboard ingestion for supervisor and ops visibility.

This document is execution-oriented and explicitly follows the mandatory development workflow in `~/.claude/CLAUDE.md`.

## Current State Analysis

- Agents use `workspace` (path to user-managed OpenClaw workspace directory) instead of a `role` enum.
- Multi-agent config already supports `supervises` validation. Having `supervises` makes an agent a supervisor.
- SQLite already stores `agent_id` across compliance/routing/budget/alerts.
- `StorageReader` already supports agent-scoped reads for recent events, routing decisions, and usage summary.
- Dashboard activity API supports event filtering but not `agentId` filtering.
- OpenClaw config is generated and merged via `generate-openclaw.ts`, with local bindings validation.

## Desired End State

- Supervisors are identified by having `supervises` in agent config (no role enum needed).
- Supervisor has `clawforce_workforce_status` access with strict scope to `supervises`.
- Supervisor can answer "what is the workforce doing right now?" from live data.
- Dashboard APIs support per-agent filtering to align with supervisor status reporting.
- OpenClaw compatibility is verified through explicit contract and integration tests.

## What We Are NOT Doing

- No separate orchestration service outside OpenClaw.
- No autonomous task reassignment in v1 (recommendations only).
- No multi-cluster/global workforce coordination in this scope.
- No replacement of existing router/compliance plugin architecture.

## Mandatory Development Workflow (Execution Contract)

All implementation work for this plan must follow this sequence:

1. **Research**
   - Confirm exact touched files and current behavior before edits.
2. **Plan**
   - Use this plan as source of truth.
3. **Plan Review (Sub-agent)**
   - Review for edge cases, compatibility gaps, and test coverage omissions.
4. **Branch + Draft PR (before coding)**
   - `git checkout main && git pull`
   - `git checkout -b feat/ultron-supervisor-template`
   - `git push -u origin feat/ultron-supervisor-template`
   - `gh pr create --draft --base main --title "feat: add ultron supervisor template and status tooling"`
   - Pre-commit quality gates on every commit:
     - `pnpm precommit:root`
     - `pnpm precommit:dashboard`
5. **Implement in phases with strict cycle**
   - Write -> Test -> Commit -> Push for each logical unit.
6. **Code Review (Sub-agent)**
   - Review all diffs for regressions, contracts, and security boundaries.
7. **Fixes**
   - Address findings with separate commits (no amend unless explicitly needed and allowed).
8. **Smoke Test Loop**
   - Validate real feature path end-to-end and iterate until stable.
9. **Documentation**
   - Update docs impacted by new supervisor and tool usage.
10. **Open PR**
   - Mark draft ready only after all gates pass.

## Task Checklist (Must Be Tracked During Execution)

- [ ] Task 1: Research & confirm file touchpoints
- [ ] Task 2: Plan review via sub-agent
- [ ] Task 3: Create feature branch + draft PR
- [ ] Task 4: Phase 1 implementation (supervisor via `supervises`)
- [ ] Task 5: Phase 2 implementation (supervisor status tool)
- [ ] Task 6: Phase 3 implementation (dashboard agent filters)
- [ ] Task 7: Phase 4 implementation (OpenClaw compatibility hardening)
- [ ] Task 8: Code review via sub-agent
- [ ] Task 9: Smoke test and fix loop
- [ ] Task 10: Documentation updates
- [ ] Task 11: Mark PR ready

## Plan Review Outcome (Step Complete)

Plan review completed before implementation. The following blockers are now explicitly resolved in this plan:

- Tool registration path for `clawforce_workforce_status`
- Caller identity flow for supervisor scope enforcement
- Agent-scoped alerts query support and DB index migration
- Supervisor behavior (triggered by `supervises` field)
- Explicit pre-commit verification commands

## Phase 1: Enable Supervisor via `supervises` Field

### Changes Required

**Files**:
- `src/config/types.ts`

### Implementation Notes

- Supervisors are identified by having a `supervises` field on the agent entry (no role enum needed).
- Each agent uses a `workspace` field pointing to the user's own OpenClaw workspace directory.
- Keep backward compatibility for existing configs.
- Users manage their own workspace contents (SOUL.md, SKILL.md, etc.).

### Success Criteria

#### Automated Verification
- [ ] Schema accepts agents with `supervises` field.
- [ ] Existing config fixtures still validate.

#### Manual Verification
- [ ] `clawforce deploy` succeeds with one supervisor (agent with `supervises`) + worker agents.

### Write -> Test -> Commit -> Push Unit Breakdown

1. Schema update + tests -> commit -> push
2. Template files + validation tests -> commit -> push

## Phase 2: Implement Supervisor Workforce Status Tool

### Changes Required

**Files**:
- `src/tools/supervisor-status.ts` (new)
- `src/storage/reader.ts` (only if helper extensions are needed)
- `src/config/generate-openclaw.ts` (tool wiring for agents with `supervises`)
- optional tool registration config files
- `src/storage/migrations.ts` (new migration for alerts agent index)

### Tool Contract (v1)

- `getAgentActivity(agentIds, since, event?, limit?)`
- `getAgentBudgets(agentIds)`
- `getAgentAlerts(agentIds, since, severity?, unacknowledgedOnly?)`
- `getWorkforceMetrics(agentIds, days)`

### Tool Registration and Invocation Path (Explicit)

- Registration is config-driven in generated OpenClaw config.
- In `generate-openclaw.ts`, when building `agents.list`, agents with `supervises` get per-agent tool enablement:
  - `tools: { clawforce_workforce_status: { enabled: true } }`
- Non-supervisor agents (those without `supervises`) do not receive this tool by default.
- Enforcement is generated per agent profile during config generation.

### Caller Identity and Scope Enforcement

- Caller identity source: OpenClaw tool invocation context must provide current `agentId` (caller).
- `supervisor-status.ts` resolves allowed target agents from config (`supervises` list for caller agent).
- Requested `agentIds` must be subset of allowed list; otherwise request fails with explicit authorization error.
- If caller `agentId` is missing, deny by default.

### Security and Scope Rules

- All requested `agentIds` must be subset of caller's `supervises`.
- Reject out-of-scope agent access with explicit, auditable error.
- Default limits to safe values; enforce upper bounds:
  - `limit` default `100`, max `500`
  - `since` default `24h`, max window `30d`

### Success Criteria

#### Automated Verification
- [ ] Correct data returned for supervised agents.
- [ ] Out-of-scope agent queries are denied.
- [ ] Empty datasets produce stable, typed responses.
- [ ] Missing caller identity is denied.
- [ ] `StorageReader.getAlerts` supports agent-scoped reads.
- [ ] New alerts index migration is applied successfully.

#### Manual Verification
- [ ] Supervisor can answer real-time workforce status queries from recent data.

### Write -> Test -> Commit -> Push Unit Breakdown

1. Tool module + unit tests -> commit -> push
2. Config/tool wiring + integration tests -> commit -> push
3. Scope enforcement tests -> commit -> push
4. Alerts query extension + migration + tests -> commit -> push

## Phase 3: Dashboard Agent-Scoped Ingestion

### Changes Required

**Files**:
- `clawforce-dashboard/src/app/api/activity/route.ts`
- `clawforce-dashboard/src/app/api/activity/stream/route.ts`
- `clawforce-dashboard/src/lib/activity-poller.ts`
- optional cost route updates if per-agent cost drill-down is included now

### Implementation Notes

- Add `agentId` query parameter support without breaking existing no-filter behavior.
- Ensure stream payloads include/retain agent identity consistently.
- Keep defaults backward compatible (`All Agents` behavior).
- Activity route must pass `agentId` through query conditions in SQLite path.
- Stream route should support optional `agentId` filtering (query param) or clearly document all-agent-only stream behavior; preferred: support optional filter.

### Success Criteria

#### Automated Verification
- [ ] `agentId` API filter returns correct scoped data.
- [ ] No-filter path returns unchanged aggregate behavior.

#### Manual Verification
- [ ] Dashboard can switch between all-agent and per-agent activity views.

### Write -> Test -> Commit -> Push Unit Breakdown

1. API filter support + API tests -> commit -> push
2. stream/poller alignment + tests -> commit -> push

## Phase 4: OpenClaw Compatibility Hardening

### Changes Required

**Files**:
- `src/plugins/manifest-schema.ts`
- integration tests for generated config and plugin loading

### Implementation Notes

- Validate bindings remain aligned with OpenClaw contract.
- Validate plugin manifest schema behavior under version drift.
- Add compatibility matrix note in docs for tested OpenClaw versions.
- Ensure generated `agents.list` includes `tools.clawforce_workforce_status.enabled=true` for agents that have `supervises`.

### Success Criteria

#### Automated Verification
- [ ] Generated bindings pass contract tests for supported OpenClaw version(s).
- [ ] Manifest/schema drift fails with actionable messages.
- [ ] Generated OpenClaw config includes supervisor tool wiring for agents with `supervises` and excludes it for other agents.

#### Manual Verification
- [ ] End-to-end deploy against OpenClaw image starts and routes correctly.

### Write -> Test -> Commit -> Push Unit Breakdown

1. Contract test updates -> commit -> push
2. validation hardening + docs note -> commit -> push

## Code Review and Smoke Test Gates

### Code Review Gate (Sub-agent Required)

- Review entire PR diff (not just latest commit) for:
  - scope bypass risks in supervisor tool,
  - caller identity assumptions and fail-closed behavior,
  - regressions in multi-agent config generation,
  - dashboard API backward compatibility,
  - OpenClaw contract assumptions.

### Smoke Test Loop (Required Before PR Ready)

1. Deploy local multi-agent setup (1 supervisor, 2+ workers).
2. Trigger representative activity:
   - normal task execution,
   - model/provider failure,
   - budget threshold,
   - policy/alert event.
3. Run supervisor status queries and confirm expected outputs.
4. Verify dashboard reflects matching per-agent and aggregate data.
5. If broken, fix and loop.
6. Re-run full test suite after smoke-test fixes.
7. Commit/push smoke-test fixes separately.

## Testing Strategy

### Unit Tests

- Role schema and validation changes.
- Supervisor tool query and authorization logic.
- Error handling and boundary checks for request limits/time windows.
- Storage reader alerts filtering (`agentId`/scoped behavior).

### Integration Tests

- Config generation for multi-agent with supervisor (agent with `supervises`).
- OpenClaw config compatibility checks.
- Dashboard API filtering behavior (`agentId` and no-filter paths).
- Migration path test for new alerts agent index.

### Manual Verification

- End-to-end deploy and operations-style status querying.
- Dashboard consistency checks against SQLite-backed data.

## Documentation Deliverables

Update after implementation:

- `docs/MULTI-AGENT.md` (supervisor pattern and config examples)
- `docs/GETTING_STARTED.md` (minimal supervisor setup flow)
- `docs/INFRASTRUCTURE-DEPLOYMENT.md` (ops and compatibility notes)

## PR Readiness Criteria

Do not mark draft PR ready until all are true:

- [ ] All phase tests pass.
- [ ] Sub-agent code review complete and findings resolved.
- [ ] Smoke test loop complete with green results.
- [ ] Documentation updates committed and pushed.
- [ ] No unresolved compatibility risks for target OpenClaw version.
