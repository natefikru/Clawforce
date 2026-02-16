# Security, Testing, and CI/CD Hardening Plan (2026-02-16)

## Objective

Close the highest-risk security and testing gaps for Clawforce and enforce required quality gates in CI/CD:

- Unit tests
- Integration tests
- Knip
- Security checks
- Type checks
- Build

## Mandatory Development Workflow Compliance (CLAUDE.md 74-75)

This plan explicitly follows the required non-trivial workflow:

`Research -> Plan -> Plan Review -> Branch + Draft PR -> Implement (Write/Test/Commit/Push per task) -> Code Review -> Fix -> Smoke Test -> Documentation -> PR Ready`

For every implementation task below, execution must include:

1. Confirm this is non-trivial and follow the full workflow.
2. Write/adjust tests first where behavior changes.
3. Run task-scoped checks.
4. Commit only after checks pass.
5. Push after each task to keep the draft PR current.

## Execution Status (Workflow Trace)

- [x] Research: security/testing gaps and CI gate state validated.
- [x] Plan review: scope tightened with required PR smoke and branch-protection checklist.
- [x] Implement phase 1: CI gate wiring + required smoke job.
- [x] Implement phase 2: security controls (audit bypass guardrail, transport policy, secret boundary updates).
- [x] Implement phase 3: unit test coverage for untested runtime modules.
- [x] Implement phase 4: integration/smoke reinforcement and required smoke command.
- [x] Verification: `pnpm check:ci` passes.

## Scope

### In Scope

1. Security hardening for secrets, transport policy, and deploy audit bypass guardrails.
2. Test hardening for untested critical runtime modules.
3. CI/CD hardening to make all required checks explicit and blocking.
4. Smoke-test automation plan for security and reliability paths.

### Out of Scope

1. Secret-manager platform migration (Vault/AWS/GCP) beyond immediate guardrails.
2. Full multi-agent product features.
3. Non-critical dashboard UX work.

## Phase Plan with Workflow Gates

## Phase 1 - CI/CD Gate Enforcement

### Goal

Add explicit CI jobs for all required checks and make failures visible per gate.

### Implementation

- Add workflow file under `.github/workflows/ci.yml`.
- Add/standardize scripts for:
  - `test:unit`
  - `test:integration`
  - `test:smoke` (required on PR)
  - `typecheck`
  - `build`
  - `knip` (root + dashboard)
  - `check:security`
- Add repository branch protection with required status checks for all CI jobs.

### Branch Protection Enforcement (Blocking)

Owner: repository maintainers/admins

Required branch protection settings:

1. Require status checks to pass before merging.
2. Require branches to be up to date before merging.
3. Required status checks:
   - `Unit Tests`
   - `Integration Tests`
   - `Smoke Tests`
   - `Type Checks`
   - `Build`
   - `Knip`
   - `Security Audit`
4. Disallow bypass except for admins with explicit change ticket reference.

### Workflow Checklist (Required)

- Research: confirm current scripts and lockfile layout.
- Plan review: verify required checks map 1:1 to jobs.
- Implement: add scripts/workflow.
- Test: run scripts locally (`pnpm test:unit`, `pnpm test:integration` minimum).
- Commit + push.

## Phase 2 - Security Controls Hardening

### Goal

Reduce credential exposure and enforce safer defaults.

### Tasks

1. **Audit bypass guardrail**
   - Prevent `CLAWFORCE_SKIP_SECURITY_AUDIT=1` usage outside explicit local/dev context.
2. **Transport security policy**
   - Require `https://` for Slack webhooks.
   - Enforce secure SMTP policy (TLS-only configuration).
3. **Secret handling boundary**
   - Stop flowing plaintext notification credentials through plugin config where possible.
   - Introduce env/secret-reference pattern for sensitive fields.

### Target Files and Test Mapping

1. **Audit bypass guardrail**
   - Files:
     - `src/commands/deploy.ts`
     - `src/openclaw/security-audit.ts`
     - `test/unit/commands/deploy.test.ts`
     - `test/integration/deploy-security-audit-gate.test.ts`
   - Required tests:
     - bypass allowed only in explicit local/dev mode
     - bypass rejected in non-local mode

2. **Transport security policy**
   - Files:
     - `src/config/types.ts`
     - `src/alerts/notifiers/slack.ts`
     - `src/alerts/notifiers/email.ts`
     - `test/unit/config/types-alerts.test.ts`
     - `test/unit/alerts/dispatcher.test.ts`
     - `test/unit/alerts/email-notifier.test.ts`
   - Required tests:
     - Slack webhook must be `https://`
     - SMTP config fails validation without secure transport requirements

3. **Secret handling boundary**
   - Files:
     - `src/config/generate-openclaw.ts`
     - `src/plugins/clawforce-router/index.ts`
     - `test/unit/config/generate-openclaw.test.ts`
     - `test/unit/plugins/clawforce-router/index.test.ts`
   - Required tests:
     - no plaintext credential fields in generated plugin config
     - env/secret reference format accepted and resolved safely

### Workflow Checklist (Required)

- Research: enumerate all secret and transport entry points.
- Plan review: confirm no behavior regressions for local development.
- Implement in small slices with tests.
- Run unit + integration tests per slice.
- Commit + push each slice.

## Phase 3 - Unit Test Coverage Hardening (Critical Runtime Paths)

### Goal

Cover high-risk modules currently under-tested or untested.

### Target Modules

- `src/docker/exec.ts`
- `src/docker/health.ts`
- `src/commands/stop.ts`
- `src/commands/plugins-watch.ts`
- `src/alerts/notifiers/email.ts`
- `src/openclaw/security-audit.ts`

### Required Test Scenarios

- Command spawn failure and non-zero exit behavior.
- Health polling timeout and container-not-found behavior.
- Stop command success/no-deploy/error branches.
- Plugin watch signal handling and plugin-selection failure paths.
- Email notifier SMTP mode + local sendmail fallback.
- Security audit parsing and execution failure handling.

### Workflow Checklist (Required)

- Research: derive all branches from source.
- Plan review: verify assertions cover failure and edge paths.
- Implement tests first for each file.
- Run `pnpm test:unit`.
- Commit + push per module or logical pair.

## Phase 4 - Integration and Smoke Test Hardening

### Goal

Increase confidence in security invariants and deployment reliability.

### Integration Tests to Add (Priority)

1. Realistic deploy + stop lifecycle assertions.
2. Security-audit gate with failing audit simulation contract.
3. PII invariant regression test: sensitive content never routes to cloud.
4. Alert delivery degradation behavior (one channel fails, others continue).
5. Dual-write resilience (JSONL remains durable when SQLite write fails).

### Smoke Tests to Automate

- Deploy health
- Plugin activation
- Routing sanity (PII vs non-PII)
- Compliance log write/read
- Security gate fail/allow behavior
- Stop cleanup verification
- PR smoke suite (`test:smoke`) is mandatory for merge eligibility.

### Workflow Checklist (Required)

- Research: align smoke tests with `test/SMOKE_TEST.md`.
- Plan review: ensure smoke tests are deterministic in CI.
- Implement integration/smoke tests.
- Run integration and smoke suite.
- Commit + push.

## Phase 5 - Documentation and Verification Closure

### Goal

Document the final hardening posture and make operational expectations explicit.

### Tasks

- Update `README.md` security/testing sections.
- Update `ROADMAP.md` hardening status and follow-up items.
- Add final verification log (commands + pass/fail).

### Workflow Checklist (Required)

- Research: confirm implementation matches docs.
- Plan review: verify docs cover security and CI expectations.
- Implement docs updates.
- Re-run full verification suite.
- Commit + push.

## CI/CD Required Gate Matrix

All checks below must be configured as required status checks on protected branches:

1. `Unit Tests`
2. `Integration Tests`
3. `Smoke Tests`
4. `Type Checks`
5. `Build`
6. `Knip`
7. `Security Audit`

## Security Exception Policy (Required)

Security gate failures are blocking by default.

Temporary exception rules:

1. Exception requires a tracked issue with owner and expiry date.
2. Exception approval requires maintainer sign-off.
3. Exception lifespan must not exceed 14 days.
4. PR must include remediation plan and follow-up milestone.
5. Expired exceptions immediately re-block merges.

## Verification Commands

Run before PR readiness:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:smoke
pnpm typecheck
pnpm build
pnpm knip --include dependencies,unlisted,unresolved
pnpm knip --directory clawforce-dashboard --include dependencies,unlisted,unresolved
pnpm check:security
```

## Deliverables

1. New CI workflow with explicit required checks.
2. Script aliases for unit/integration/CI composition.
3. Security and testing hardening plan documented with mandatory workflow compliance at every phase.
4. Follow-on implementation PR(s) using the same workflow.
