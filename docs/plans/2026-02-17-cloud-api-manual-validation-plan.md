# Cloud, Local-Only, and Hybrid Manual Validation Plan

**Date**: 2026-02-17  
**Status**: Ready to execute  
**Scope**: Validate Clawforce in Cloud API mode, Local-Only mode, and Hybrid mode with basic connectors, including configuration, deployment, command workflow, and OpenClaw runtime behavior.

---

## Overview

This plan defines a manual test workflow to confirm that:

1. Clawforce commands are used correctly (`deploy`, `status`, `route-test`, `audit`, `stop`).
2. Configuration files are valid and produce the expected generated artifacts.
3. OpenClaw agents are deployed and bound to channels as intended.
4. OpenClaw + Clawforce runtime behavior matches critical product invariants (routing, PII safety, compliance logging, dashboard visibility).
5. Routing decisions are correct across three deployment modes:
   - Cloud API only
   - Local model only
   - Hybrid (cloud + local with policy-based switching)

This is an operations validation plan, not a feature implementation plan.

---

## Current-State Assumptions

- Running in Cloud API mode first (no local runtime sidecar required).
- At least one cloud model provider key is available (for example Anthropic).
- Local runtime can be started for local-only and hybrid validation (`ollama`, `sglang`, or `vllm`).
- At least one connector path is configured in `openclaw.channels` and agent bindings are defined.
- Dashboard is enabled for runtime observability.
- Validation is manual-first and evidence-driven (CLI outputs, logs, screenshots).

---

## Desired End State

At completion, we can confidently state:

- Deployment is reproducible from config using standard Clawforce commands.
- Generated OpenClaw config matches intended agent/channel bindings.
- Connectors pass real traffic end-to-end through OpenClaw agents.
- Safety behavior is correct: PII is never sent to cloud models.
- Compliance and routing events are queryable in both JSONL and SQLite.
- Dashboard reflects live system state and critical alerts.

---

## Out of Scope

- Full multi-agent Ultron orchestration validation.
- Performance/load testing at production scale.
- Kubernetes/terraform deployment validation.
- Deep connector-provider debugging beyond basic e2e message flow.

---

## Execution Contract

Follow phases in order. Do not mark the run complete unless all success criteria pass or any failures are documented with clear reproduction steps.

For each test, capture:

- timestamp
- exact command(s) run
- prompt/input used
- expected vs actual result
- evidence path (screenshot/log snippet)
- pass/fail

---

## Phase 0: Preflight and Test Data Setup

### Tasks

- [ ] Confirm Node.js 22+ and Docker/Compose availability.
- [ ] Export required secrets (`ANTHROPIC_API_KEY`, connector tokens, dashboard password if auth enabled).
- [ ] Create or use dedicated cloud profile config (`test/fixtures/e2e/runtime-cloud.yaml`).
- [ ] Prepare prompt pack:
  - safe simple prompt
  - safe complex prompt
  - direct PII prompt (SSN)
  - obfuscated/adversarial PII prompt
  - prompt likely to emit PII in response

### Success Criteria

- [ ] All required env vars resolve correctly.
- [ ] Test config validates syntactically and semantically.
- [ ] Prompt pack exists and is ready for repeatable testing.

---

## Phase 1: Cloud API Configuration Validation

### Required Config Checks

- [ ] `models.cloud` is a cloud provider model.
- [ ] `models.credential_mode` is set appropriately (for example `env`).
- [ ] `router.enabled: true`.
- [ ] `compliance.enabled: true`.
- [ ] `dashboard.enabled: true`.
- [ ] `dashboard.auth.enabled` explicitly declared.
- [ ] `openclaw.channels` contains at least one connector configuration.
- [ ] At least one agent/channel binding path exists through agent workspace or passthrough config.

### Validation Commands

```bash
clawforce route-test "safe validation prompt" -c test/fixtures/e2e/runtime-cloud.yaml
clawforce route-test "my SSN is 123-45-6789" -c test/fixtures/e2e/runtime-cloud.yaml
```

### Success Criteria

- [ ] Safe prompt route-test returns a cloud model decision.
- [ ] PII prompt route-test indicates fail-closed behavior in cloud-only mode.
- [ ] No config parsing or schema validation errors.

---

## Phase 2: Deploy and Verify Generated Artifacts

### Deploy Workflow

```bash
clawforce deploy -c test/fixtures/e2e/runtime-cloud.yaml
clawforce status
```

### Artifact Validation Checklist

- [ ] Deployment directory generated (`clawforce-<name>/`).
- [ ] `config/openclaw.json` exists.
- [ ] `config/extensions/clawforce-router/openclaw.plugin.json` exists.
- [ ] `docker-compose.yml` exists and containers are healthy.
- [ ] `data/` includes expected files (`compliance.jsonl`, `routing.jsonl`, `clawforce.db` once traffic starts).

### OpenClaw Config Validation Points

- [ ] Agent list in generated OpenClaw config matches intended deployment.
- [ ] Channel/binding rules map traffic to the expected agent(s).
- [ ] Plugin hooks include: `before_agent_start`, `message_sending`, `tool_result_persist`, `agent_end`.

### Success Criteria

- [ ] `clawforce deploy` completes without blocking errors.
- [ ] `clawforce status` reports healthy services.
- [ ] Generated OpenClaw artifacts are present and internally consistent.

---

## Phase 3: Connector and Agent Runtime E2E Tests

### Scenario A: Safe Message Through Connector

**Goal**: Validate connector -> OpenClaw agent -> response loop.

Steps:
1. Send safe simple prompt through configured connector channel.
2. Confirm agent responds in correct channel/DM.
3. Repeat with safe complex prompt.

Success:
- [ ] Both prompts receive valid responses.
- [ ] No routing/plugin errors in logs.
- [ ] Activity appears in dashboard feed.

### Scenario B: PII Message Handling in Cloud API Mode

**Goal**: Verify safety invariant under cloud-only deployment.

Steps:
1. Send direct PII prompt.
2. Send obfuscated/adversarial PII prompt.

Success:
- [ ] Requests are blocked/fail-closed (not routed to cloud model).
- [ ] PII detection/compliance event is recorded.
- [ ] Behavior is consistent across both PII variants.

### Scenario C: Outbound Redaction

**Goal**: Validate output filtering before message is sent.

Steps:
1. Send prompt likely to produce email/card-like output.
2. Inspect returned output and logs.

Success:
- [ ] Sensitive output is redacted when detected.
- [ ] Redaction behavior is traceable in compliance events.

---

## Phase 4: Audit, Storage, and Dashboard Validation

### Commands

```bash
clawforce audit --source compliance -n 50
clawforce audit --source database -n 50
clawforce audit --source database --event routing_decision -n 50
clawforce audit --source database --pii-only -n 50
```

### Validation Checklist

- [ ] Routing decisions are persisted and queryable.
- [ ] Compliance events are persisted and queryable.
- [ ] PII-related events are discoverable via `--pii-only`.
- [ ] JSONL and SQLite event streams are consistent for tested scenarios.
- [ ] Dashboard shows status, activity, and alerts in near real-time.

### Success Criteria

- [ ] No missing critical event type across tested flows.
- [ ] Dashboard data aligns with CLI audit output.

---

## Phase 5: Negative and Recovery Tests

### Negative Tests

- [ ] Invalid/missing connector credential produces clear startup/runtime failure.
- [ ] Missing required dashboard auth declaration fails clearly when dashboard enabled.
- [ ] Invalid model/provider reference surfaces explicit configuration error.

### Recovery Tests

- [ ] Restart deployment and verify service health returns.
- [ ] Verify prior audit data remains available after restart.
- [ ] Send fresh prompt and confirm new events append normally.

### Commands

```bash
clawforce stop
clawforce deploy -c test/fixtures/e2e/runtime-cloud.yaml
clawforce status
```

### Success Criteria

- [ ] Failure states are explicit and diagnosable.
- [ ] Recovery path is reliable and preserves historical logs.

---

## Phase 6: Local-Only Mode Validation

### Objective

Validate that OpenClaw agents run correctly when Clawforce routes all traffic to local runtime only, with no cloud model dependency.

### Configuration Profile

- [ ] Create or use local-only profile config (`test/fixtures/e2e/runtime-local.yaml`).
- [ ] Set `models.cloud` to a local model reference (for example `ollama/llama3.3:8b`).
- [ ] Set runtime engine/location for local runtime (`container` or `host`).
- [ ] Disable cloud provider dependency for this profile.
- [ ] Keep `router.enabled` and `compliance.enabled` enabled.

### Commands

```bash
clawforce route-test "safe validation prompt" -c test/fixtures/e2e/runtime-local.yaml
clawforce route-test "my SSN is 123-45-6789" -c test/fixtures/e2e/runtime-local.yaml
clawforce deploy -c test/fixtures/e2e/runtime-local.yaml
clawforce status
```

### Scenarios

1. **Safe traffic**: send simple and complex prompts through connector.
2. **PII traffic**: send direct and obfuscated PII prompts.
3. **Output redaction**: test likely sensitive output generation.
4. **Local runtime health dependency**:
   - stop local runtime temporarily
   - verify failover policy behavior (`block` or configured behavior)
   - restart runtime and verify recovery

### Success Criteria

- [ ] Route-test decisions resolve to local model for all prompts.
- [ ] Connector e2e message flow succeeds for safe prompts.
- [ ] PII prompts are processed locally (never cloud) and tracked in compliance logs.
- [ ] When local runtime is unavailable, behavior matches configured failover policy.
- [ ] After runtime recovery, normal processing resumes without redeploy.

---

## Phase 7: Hybrid Routing Validation (Cloud + Local)

### Objective

Validate policy-driven routing behavior where OpenClaw/Clawforce choose cloud or local models based on sensitivity, budget, complexity, and health state.

### Configuration Profile

- [ ] Create or use hybrid profile config (`test/fixtures/e2e/runtime-hybrid.yaml`).
- [ ] Configure `models.cloud` as cloud and `models.local` as local.
- [ ] Add explicit routing rules for at least:
  - `pii_detected` -> local
  - `low_complexity` -> local (optional but recommended)
  - `high_complexity` -> cloud
  - `over_budget` -> local fallback
- [ ] Configure `router.budget.daily_limit` to a low value for controlled budget-trigger testing.
- [ ] Enable health checks and set explicit failover policy.

### Commands

```bash
clawforce route-test "safe low complexity prompt" -c test/fixtures/e2e/runtime-hybrid.yaml
clawforce route-test "complex architecture reasoning prompt" -c test/fixtures/e2e/runtime-hybrid.yaml
clawforce route-test "my SSN is 123-45-6789" -c test/fixtures/e2e/runtime-hybrid.yaml
clawforce deploy -c test/fixtures/e2e/runtime-hybrid.yaml
clawforce status
```

### Decision Validation Matrix

- [ ] **Low complexity, non-PII** -> expected local or cloud based on configured rule.
- [ ] **High complexity, non-PII** -> expected cloud.
- [ ] **PII content** -> local only.
- [ ] **Over-budget state** -> fallback model decision is respected.
- [ ] **Local runtime unhealthy**:
  - PII request stays fail-closed
  - non-PII behavior follows configured failover policy

### Runtime Scenarios

1. Send prompts that map to each routing condition and verify model/provider override in logs.
2. Trigger budget threshold and confirm route changes.
3. Simulate local runtime outage and validate failover semantics.
4. Confirm alerts are raised for health and budget events.

### Success Criteria

- [ ] Each tested prompt type routes according to configured hybrid rules.
- [ ] No PII prompt is routed to cloud under any tested condition.
- [ ] Budget-triggered and health-triggered routing transitions are observable and correct.
- [ ] Dashboard and audit outputs show consistent routing rationale/events.

---

## Phase 8: Business Mixed-Mode Scenario Validation

### Objective

Demonstrate customer-facing value that the same agent can use cloud in one case and local in another, based on data sensitivity and task characteristics.

### Setup Requirements

- [ ] Use hybrid config profile with working cloud + local runtimes.
- [ ] Keep compliance logging and dashboard alerts enabled.
- [ ] Confirm route-test and audit commands are available during scenario execution.

### Scenario Set A: Finance Operations Agent

**A1 (Cloud expected):**  
Prompt: "Create a board-ready summary of quarterly financial trends and three recommendations."  
Data: no raw PII or account identifiers.

**A2 (Local expected):**  
Prompt: "Reconcile this payroll sample with employee records: SSN 123-45-6789, acct 987654321."  
Data: explicit sensitive identifiers.

Success:
- [ ] A1 routes to configured cloud model and returns valid response.
- [ ] A2 routes local (or fail-closed if local unavailable), never cloud.
- [ ] Compliance/routing logs clearly show different route reasons.

### Scenario Set B: Customer Support Agent

**B1 (Cloud expected):**  
Prompt: "Rewrite this outage response in a clearer and more empathetic tone."

**B2 (Local expected):**  
Prompt: "Triage this ticket with customer phone, email, and account number fields."

Success:
- [ ] B1 uses cloud path for quality/style task.
- [ ] B2 uses local path due to sensitivity detection/policy.
- [ ] Outbound response does not leak raw sensitive fields when redaction should apply.

### Scenario Set C: Research and Reporting Agent

**C1 (Cloud expected):**  
Prompt: "Synthesize these public sources into an executive one-page brief."

**C2 (Local expected):**  
Prompt: "Summarize internal notes containing customer names, emails, and payment references."

Success:
- [ ] C1 routes to cloud for synthesis-heavy non-sensitive work.
- [ ] C2 routes local due to sensitive internal content.
- [ ] Logs and dashboard activity support route rationale for both.

### Optional Scenario Set D: Notion/MCP Financial Tool Flow

If tooling is connected for this run:

1. Pull a non-sensitive Notion page and request executive rewriting (cloud expected).
2. Pull a sensitive financial Notion page (contains account/tax identifiers) and request analysis (local expected).

Success:
- [ ] Cloud is used for non-sensitive page transformation.
- [ ] Sensitive page analysis is local/fail-closed only.
- [ ] `tool_result_persist` safety behavior is reflected in audit events.

### Phase 8 Success Criteria

- [ ] At least two scenario sets pass end-to-end (A/B/C), with one cloud and one local route each.
- [ ] Evidence shows route reason, selected model/provider, and resulting output behavior.
- [ ] No sensitive scenario is routed to cloud.

---

## Phase 9: Automated Integration Test Replication

### Objective

Convert core manual validation scenarios into deterministic integration tests that run in CI and provide repeatable evidence of routing and safety behavior.

### Implemented Test Coverage

- `test/integration/business-mixed-mode-routing.test.ts`
  - finance mixed-mode scenario (cloud for non-sensitive analysis, local for sensitive payroll-like content)
  - support mixed-mode scenario (cloud rewrite, local sensitive triage)
  - research mixed-mode scenario (cloud public synthesis, local sensitive internal summary)
  - local-only profile assertions
  - hybrid profile assertions
  - cloud-first profile with PII safety-invariant assertion
- Existing integration suites continue to validate:
  - router enforcement and dimension pipeline
  - PII defense-in-depth
  - model health failover
  - deploy lifecycle and security-audit gate behavior

### How to Run

```bash
# New mixed-mode integration suite only
pnpm test:integration:mixed-mode

# Plan-aligned automated routing/safety suite
pnpm test:integration:plan

# Full runtime pipeline e2e (Docker-backed; opt-in)
CLAWFORCE_RUN_E2E=1 pnpm test:e2e:runtime

# Runtime pipeline CI wrapper (fail-fast preflight + JSON report)
pnpm test:e2e:runtime:ci

# Full integration suite
pnpm test:integration
```

### CI/Release Success Criteria

- [ ] New mixed-mode integration suite passes.
- [ ] Full integration suite passes without regressions.
- [ ] At least one automated test proves same workflow class can route cloud and local under different input sensitivity/complexity.
- [ ] Automated tests explicitly assert that sensitive prompts never route to cloud.

### Evidence to Store

- [ ] test command output logs for mixed-mode and full integration runs.
- [ ] test summary showing pass count and zero failures.
- [ ] links to test file(s) used for compliance/sales proof points.

---

## Final Sign-Off Criteria

Mark this validation run complete only when all statements are true:

- [ ] Configuration is validated and deployable with standard Clawforce commands.
- [ ] OpenClaw agents are correctly generated, deployed, and bound to intended connectors/channels.
- [ ] Safe traffic succeeds end-to-end via connectors in all tested deployment modes.
- [ ] Cloud-only mode behavior is validated, including PII fail-closed semantics.
- [ ] Local-only mode behavior is validated, including runtime dependency behavior.
- [ ] Hybrid mode routing decisions are validated for PII, complexity, budget, and health states.
- [ ] Business mixed-mode scenarios prove the same agent can route cloud for non-sensitive work and local for sensitive work.
- [ ] Compliance + routing events are stored and queryable.
- [ ] Dashboard reflects runtime activity and alerts accurately.
- [ ] Stop/redeploy/restart workflow is stable.

If any item fails, include:

- exact failing step
- command/input used
- observed output
- suspected component (`config`, `router`, `connector`, `OpenClaw binding`, `dashboard`, `storage`)
- follow-up action owner

---

## Suggested Evidence Bundle

Collect the following for this run:

- Command transcript for deploy/status/audit/stop/redeploy
- Route-test outputs for safe and PII prompts
- Route-test outputs for local-only and hybrid decision prompts
- Business scenario evidence (A/B/C/D) showing cloud vs local decision outcomes
- Connector message screenshots (safe + blocked PII)
- Dashboard screenshots (status, activity, alerts)
- Audit snippets showing routing + compliance + pii-only entries

Store under:

`docs/validation-evidence/multi-mode-<YYYY-MM-DD>/`

