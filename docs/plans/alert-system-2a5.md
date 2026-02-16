# Alert System (Phase 2A.5) - Implementation Plan

**Date**: 2026-02-15  
**Phase**: 2A.5  
**Status**: Planned  
**Roadmap Reference**: `ROADMAP.md` section `2A.5 Alert System`  
**Dependencies**: 2A.3 real-time SSE (complete), 2A.4 model health monitoring (complete), SQLite storage layer (complete)

---

## Overview

Implement a complete alerting path for Clawforce operators:

- Detect critical operational conditions in router/runtime paths.
- Persist alerts to SQLite with acknowledgment tracking.
- Stream alert updates in real time to dashboard via SSE.
- Provide dashboard API + UI for viewing and acknowledging alerts.
- Optionally fan out to Slack and email without affecting core execution on delivery failures.

This plan is designed for low-risk, incremental delivery with explicit test and phase gates.

---

## Current State Analysis

### Existing System Behavior

- `alerts` table already exists in SQLite with `acknowledged` column and indexes.
- Backend can already write alerts (`StorageWriter.writeAlert`) and read alerts (`StorageReader.getAlerts`).
- Model health degradation already emits alerts.
- Dashboard SSE stream exists with named events and reconnection support.
- Dashboard currently has no alerts panel, no alert API, and no acknowledgment flow.

### Known Gaps

- No `alerts` section in `clawforce.yaml` schema.
- Missing trigger coverage for budget exceeded, PII violation, agent error, and idle.
- Missing alert read/ack API routes.
- Missing SSE alert source.
- Missing alert panel UI.
- Missing Slack/email notifier modules.

---

## Desired End State

- All roadmap 2A.5 trigger classes emit alerts:
  - `agent_error`
  - `budget_exceeded`
  - `pii_violation`
  - `model_health`
  - `agent_idle`
- Alerts are queryable and acknowledgeable in dashboard.
- Dashboard receives `event: alert` updates over SSE.
- Notifications (Slack/email) are optional and best-effort.
- Config is validated via `clawforce.yaml`.

### Alert Contract

#### Severity (aligned with current code)

- `info`
- `warning`
- `error`

#### Required fields

- `ts`, `severity`, `type`, `message`
- optional: `agentId`, `data`
- `acknowledged` defaults to `false`

#### Trigger semantics

- **PII invariant**: after model selection, if `hasPII && !isLocalModel(selectedModel)`, emit `pii_violation` and block request.
- **Budget exceeded**: emit `budget_exceeded` when out of budget; apply cooldown to prevent alert storms.
- **Agent error**: in-scope for this phase includes router-controlled hard failures (failover block, invariant block, budget auto-block).
- **Agent idle**: per-agent idle detection from router-observed activity signals.

---

## What We're NOT Doing

- PagerDuty/Opsgenie/escalation chains.
- Multi-tenant alert routing policies.
- Full runtime-wide error taxonomy beyond router-owned failure surfaces.
- Real-time alert streaming in JSONL fallback mode (SQLite path is primary for alerts).

---

## Configuration Plan

Add `alerts` block in `src/config/types.ts`:

```yaml
alerts:
  enabled: true
  types:
    model_health: true
    budget_exceeded: true
    pii_violation: true
    agent_error: true
    agent_idle: true
  idle:
    threshold_minutes: 60
    cooldown_minutes: 30
  budget:
    cooldown_minutes: 60
    auto_block_on_exceeded: false
  notifications:
    dashboard: true
    slack:
      enabled: false
      webhook_url: ""
    email:
      enabled: false
      smtp_host: ""
      smtp_port: 587
      username: ""
      password: ""
      from: ""
      to: []
```

Validation rules:

- malformed webhook URLs/emails fail validation.
- all alert channels are optional.
- backward-compatible defaults when `alerts` is omitted.

---

## Implementation Flow (Execution Checklist)

This plan is executed as:

Research -> Plan -> Plan Review -> Branch + Draft PR -> Implement (Write -> Test -> Commit -> Push per phase) -> Code Review -> Fix -> Smoke Test -> Docs -> PR Ready

Before implementation:

- [ ] Plan review complete and feedback incorporated.
- [ ] Branch from updated `main`.
- [ ] Draft PR opened before coding starts.

During implementation:

- [ ] One logical commit per phase.
- [ ] Tests added/updated in same phase as code.
- [ ] Push after each phase to keep draft PR current.

---

## Phase 0: Contracts and Config

### Changes Required

**File**: `src/config/types.ts`
- Add `alerts` config schema + defaults.

**File**: `src/storage/types.ts` (or `src/alerts/types.ts`)
- Add/standardize alert type union constants:
  - `ALERT_TYPES = ["model_health", "budget_exceeded", "pii_violation", "agent_error", "agent_idle"] as const`
  - `type AlertType = typeof ALERT_TYPES[number]`
  - Use `AlertType` for alert entry `type` values.

**File**: `src/config/parse.ts`
- Parse and validate `alerts` config from `clawforce.yaml`.

**File**: `src/config/generate-openclaw.ts`
- Thread config into plugin config:
  - `clawforce.yaml` -> parsed `ClawforceConfig` -> generated `openclaw.json` plugin config -> router `pluginConfig.alerts`.

### Success Criteria

#### Automated Verification
- [ ] Config validation tests pass for valid/invalid alert configs.
- [ ] Existing config fixtures still parse.
- [ ] Integration test: generated plugin config includes `alerts` block when configured.
- [ ] Integration test: generated plugin config includes default `alerts` values when omitted.
- [ ] `npm run typecheck` (root) passes.
- [ ] `npm test` (root) passes.

#### Manual Verification
- [ ] Launch with no `alerts` block and confirm defaults apply.
- [ ] Launch with invalid webhook URL and confirm config fails fast.

**Pause for human verification before Phase 1.**

---

## Phase 1: Backend Alert Trigger Coverage

### Changes Required

**File**: `src/plugins/clawforce-router/budget-tracker.ts`
- Add callback/event hook for budget exceeded.
- Respect budget cooldown (`alerts.budget.cooldown_minutes`).

**File**: `src/plugins/clawforce-router/index.ts`
- Emit `budget_exceeded` on callback.
- Enforce PII invariant:
  - if `hasPII && !isLocalModel(selectedModel)` and local fallback is cloud, emit `pii_violation` and block.
  - if safe local fallback exists, route local and still emit `pii_violation` for invariant-attempt visibility.
- Emit `agent_error` for router-controlled hard failures.
- Keep `model_health` alert behavior, normalize type/severity/message structure.

**File**: `src/plugins/clawforce-router/idle-monitor.ts` (new)
- Track last activity per `agentId`.
- Idle activity source: router hook events (`before_agent_start` and completion/error paths with agent context).
- Emit `agent_idle` when threshold exceeded and cooldown window passed.

### Success Criteria

#### Automated Verification
- [ ] Unit tests for each trigger type.
- [ ] Toggle tests: disabled alert type does not emit.
- [ ] Cooldown tests for `budget_exceeded` and `agent_idle` using deterministic time (`vi.useFakeTimers()` or injected clock).
- [ ] Cooldown contract test: first event emits, second within window suppressed, third after window emits.
- [ ] `npm run typecheck` (root) passes.
- [ ] `npm test` (root) passes.

#### Manual Verification
- [ ] Force over-budget path; confirm one alert emitted within cooldown window.
- [ ] Force PII-to-cloud attempt; confirm route blocked and `pii_violation` persisted.
- [ ] Simulate idle threshold exceedance; confirm `agent_idle` persisted.

**Pause for human verification before Phase 2.**

---

## Phase 2: Dashboard Alerts API + Acknowledgment Writes

### Changes Required

**File**: `clawforce-dashboard/src/app/api/alerts/route.ts` (new)
- Implement `GET` with filters: `severity`, `type`, `unacknowledgedOnly`, `since`, `limit`.

**File**: `src/storage/reader.ts`
- Extend `getAlerts()` to support `type` filter.

**File**: `clawforce-dashboard/src/lib/db.ts`
- Add explicit write-capable DB access helper for ack route only (`getWriteDb`).
- Configure busy timeout and short lock wait policy for write path.

**File**: `clawforce-dashboard/src/app/api/alerts/[id]/acknowledge/route.ts` (new)
- Implement `POST` to set `acknowledged=1`.
- Return strict success/failure response contract.

Acknowledgment API contract:

- `POST /api/alerts/[id]/acknowledge`
- `200`: `{ acknowledged: true }` on success.
- `200`: `{ acknowledged: true }` when already acknowledged (idempotent re-ack).
- `400`: `{ error: "Invalid alert ID" }` for non-numeric ID.
- `404`: `{ error: "Alert not found" }` when update touches zero rows.
- `503`: `{ error: "Database busy" }` when SQLite write lock timeout is exceeded.

### Success Criteria

#### Automated Verification
- [ ] Route tests for `GET` filters, including `type`.
- [ ] Route tests for acknowledge success, missing ID, and idempotent re-ack.
- [ ] Route tests for invalid ID (`400`) and DB-busy handling (`503`).
- [ ] `npm run typecheck` (root) passes.
- [ ] `npm test` (root) passes.
- [ ] `npm run lint` (dashboard) passes.
- [ ] `npm run test` (dashboard) passes.

#### Manual Verification
- [ ] Query alerts API with each filter and verify expected rows.
- [ ] Acknowledge from API client and verify `acknowledged=1` in SQLite.

**Pause for human verification before Phase 3.**

---

## Phase 3: SSE Alert Stream Integration

### Changes Required

**File**: `clawforce-dashboard/src/lib/alert-poller.ts` (new)
- Implement alert poller with bounded polling interval (target: 2s).
- Use cursor/diff strategy to avoid duplicate heavy payloads.
- Cursor source should use stable `alerts.id` ordering (not timestamp-only ordering).

**File**: `clawforce-dashboard/src/app/api/activity/stream/route.ts`
- Register alert poller in multiplexed stream.
- Emit named SSE event `alert`.

Behavior note:

- In SQLite-unavailable JSONL fallback mode, alerts streaming is degraded.
- `writeAlert()` currently appends alert entries to `compliance.jsonl` as `event: "alert"`.
- Fallback stream behavior should be explicit in implementation:
  - preferred: emit named SSE `event: alert` when JSONL entry has `event === "alert"`;
  - acceptable fallback: treat as `activity` and expose degraded badge in UI.

### Success Criteria

#### Automated Verification
- [ ] Poller tests for changed/new unacknowledged alert emission.
- [ ] Poller test: steady state with no new alerts emits no events.
- [ ] Poller test: acknowledged alerts are excluded from unacknowledged stream updates.
- [ ] Poller test: cursor advances by `alerts.id` and handles reconnect/backfill windows.
- [ ] Stream route tests include alert source without regressing activity/cost/status.
- [ ] `npm run lint` (dashboard) passes.
- [ ] `npm run test` (dashboard) passes.

#### Manual Verification
- [ ] Create alert and observe near-real-time `event: alert` in browser.
- [ ] Confirm no duplicate flood under steady state.

**Pause for human verification before Phase 4.**

---

## Phase 4: Dashboard Alert Panel

### Changes Required

**File**: `clawforce-dashboard/src/components/AlertPanel.tsx` (new)
- List alerts with severity/type/agent/timestamp/message.
- Unacknowledged-first default view.
- Acknowledge action wired to API route.
- Graceful empty/loading/error states.

**File**: `clawforce-dashboard/src/app/page.tsx`
- Integrate panel into dashboard layout.

### Success Criteria

#### Automated Verification
- [ ] Render tests for list, empty state, error state.
- [ ] Interaction test for acknowledge action.
- [ ] SSE update handling test for incoming `alert` events.
- [ ] `npm run lint` (dashboard) passes.
- [ ] `npm run test` (dashboard) passes.

#### Manual Verification
- [ ] Panel updates live when alert is created.
- [ ] Acknowledge removes/updates item in unacknowledged view.

**Pause for human verification before Phase 5.**

---

## Phase 5: Notification Dispatch (Slack + Email)

### Changes Required

**File**: `src/alerts/notifiers/slack.ts` (new)
- Slack webhook sender.

**File**: `src/alerts/notifiers/email.ts` (new)
- SMTP email sender.

**File**: `src/alerts/dispatcher.ts` (new)
- `dispatchAlert(entry)` orchestrates: persist first, then best-effort notify.
- Apply per-channel enablement from config.
- Log notifier failures without throwing into core flow.

Integration:

- Refactor existing router alert writes to use dispatcher sink.
- No new emission sites are required for this step; this phase unifies persistence + notification routing.

### Success Criteria

#### Automated Verification
- [ ] Unit tests with mocked Slack/email transports.
- [ ] Tests proving notifier failure does not prevent persistence.
- [ ] Explicit test: notifier throw still persists alert row and dispatcher call does not throw.
- [ ] `npm run typecheck` (root) passes.
- [ ] `npm test` (root) passes.

#### Manual Verification
- [ ] Enable Slack and verify webhook delivery for one alert type.
- [ ] Enable email and verify delivery in staging-like env.

**Pause for human verification before final verification pass.**

---

## Cross-Phase Quality Gates

Gate to move from phase N to N+1:

- [ ] Phase tests pass.
- [ ] Full relevant package tests pass.
- [ ] Changes committed and pushed.
- [ ] Human checkpoint completed.

Commands:

- Root: `npm run typecheck`, `npm test`
- Dashboard: `npm run lint`, `npm run test`

---

## Smoke Test Loop (Before PR Ready)

1. Start local stack with dashboard and router enabled.
2. Trigger each alert class intentionally:
   - budget exceeded
   - pii violation
   - model health degradation
   - agent error
   - agent idle
3. Verify for each trigger:
   - persisted row in `alerts`
   - SSE update received (SQLite mode)
   - dashboard panel reflects change
   - acknowledge updates DB state
   - optional Slack/email sent when enabled
4. Fix any failures and re-run.
5. Re-run full test suites.

---

## Rollout and Rollback

### Rollout

1. Ship with notifications disabled by default.
2. Enable Slack in pilot deployments.
3. Enable email after SMTP validation in staging.

### Rollback

- Set `alerts.enabled: false` to disable emissions quickly.
- Disable Slack/email channels independently via config.
- Keep dashboard alert UI available for historical visibility.

---

## Risks and Mitigations

- **Alert storms**: cooldown per type (`budget_exceeded`, `agent_idle`) plus bounded polling payloads.
- **Invariant regressions**: integration tests for PII-to-cloud blocking.
- **SSE load**: 2s poll interval with diff/cursor approach.
- **Write contention in dashboard**: keep ack write path narrow and route-scoped; return `503` on SQLite busy timeout and let client retry.

---

## Definition of Done

- [ ] All five roadmap alert classes emit correctly.
- [ ] Alerts persist to SQLite with reliable acknowledgment.
- [ ] Dashboard API + UI for alerts is live and tested.
- [ ] Real-time SSE alert updates function in SQLite mode.
- [ ] Slack/email optional notifications work when configured.
- [ ] Automated and manual verification checklists are complete.
