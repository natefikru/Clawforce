# Phase 2B Readiness Hardening Implementation Plan

**Goal:** Close security, cost-control, and operability gaps so Clawforce can enter Phase 2B with enterprise-safe defaults and no known foundation blockers.

**Architecture:** Keep OpenClaw as the control-plane runtime, while Clawforce hardens deployment defaults, credential handling, and per-agent accounting boundaries. Implement in small TDD slices: secure-by-default networking and auth first, then security-audit gates, then per-agent cost/compliance primitives required by multi-agent orchestration.

**Tech Stack:** TypeScript, Node.js, Zod schema validation, Docker Compose generation, Vitest, OpenClaw configuration and security-audit CLI.

---

## Mandatory Development Workflow (Blocking)

This plan follows the required non-trivial implementation workflow exactly:

`Research -> Plan -> Plan Review (sub-agent) -> Branch + Draft PR -> Implement (Write/Test/Commit/Push each phase) -> Code Review (sub-agent) -> Fix -> Smoke Test -> Documentation -> PR Ready`

### Phase 0 Workflow Checklist (must complete before Task 1 coding)

- [x] **Research complete**: current behavior verified, impacted files identified, risks logged.
- [x] **Plan complete**: this document reviewed for scope, tests, and out-of-scope boundaries.
- [x] **Plan review complete**: sub-agent review performed; edge cases and test gaps incorporated.
- [x] **Feature branch created from latest `main`**:
  - `git checkout main && git pull`
  - `git checkout -b feat/2b-readiness-hardening`
- [x] **Branch pushed**:
  - `git push -u origin feat/2b-readiness-hardening`
- [x] **Draft PR opened immediately** (before code implementation starts):
  - `gh pr create --draft --base main --title "feat: 2b readiness hardening"`
  - PR body must include summary + explicit test plan + known risks.

### Mandatory per-task execution loop (applies to Tasks 1-8)

For each task in this plan, execute the cycle below with no exceptions:

1. Write/modify code for that logical unit only.
2. Add or update tests for that unit.
3. Run tests for that unit and confirm pass.
4. Commit only after tests pass (no bypass).
5. Push commit to update draft PR.

Required quality gates for commits:
- Pre-commit hooks must pass.
- Do not reduce test coverage thresholds to make builds pass.
- If a unit has no testable behavior, document why in commit message.
- Commit and PR text must be human-written with no assistant/AI attribution.

### Execution task board (must be maintained while implementing)

Create and maintain a task list before implementation starts.

Use these task statuses only: `pending -> in_progress -> completed` (or `cancelled` if dropped).

Minimum execution board entries:
- `WF-1`: Research and current-state validation
- `WF-2`: Plan review via sub-agent
- `WF-3`: Feature branch + draft PR
- `WF-4`: Task 1 implementation
- `WF-5`: Task 2 implementation
- `WF-6`: Task 3 implementation
- `WF-7`: Task 4 implementation
- `WF-8`: Task 5 implementation
- `WF-9`: Task 6 implementation
- `WF-10`: Task 7 implementation
- `WF-11`: Task 8 verification + smoke loop
- `WF-12`: Final code review, docs, and PR ready

### Mandatory before PR Ready

- [ ] Run code review via sub-agent on all changes in branch.
- [ ] Apply fixes in separate commits (no amend).
- [ ] Push after each fix commit so draft PR stays current.
- [ ] Run smoke-test loop in real conditions and capture results.
- [ ] Re-run full verification suite (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:root`).
- [ ] Update documentation (`README.md`, `ROADMAP.md`, relevant docs in `docs/`).
- [ ] Verify commit history and PR body contain no assistant/AI attribution.
- [ ] Mark draft PR ready only after all above complete:
  - `gh pr ready`

---

## Why This Plan Exists

Phase 2A is mostly complete, but 2B readiness is blocked by foundation gaps:

1. Gateway defaults are too permissive for enterprise posture.
2. Credential flow is env-centric and not aligned with OpenClaw auth-profile workflows.
3. Deploy flow lacks explicit `openclaw security audit` gating.
4. Budget accounting is currently global (`_global`) instead of per-agent.
5. Dashboard auth defaults are too weak for enterprise-first operation.
6. 2A.6 completion status is not reflected as a formal closed gate.

This plan addresses those blockers without introducing 2B feature scope creep.

---

## Scope

### In Scope (must complete before 2B full execution)
- Secure network/auth defaults for gateway and dashboard.
- Security audit gate in deployment workflow.
- Per-agent budget tracking primitives.
- Per-agent compliance scoping verification.
- Documentation and roadmap gate updates for 2A -> 2B transition.

### Out of Scope (explicitly defer)
- Full 2B multi-agent UX/features.
- Third-party secret manager integrations (Vault/AWS/GCP).
- SIEM archival pipelines and retention automation.
- PagerDuty/Opsgenie escalation workflow.

---

## 2B Entry Gates (Definition of Ready)

All must be true before starting full 2B implementation:

- [x] Gateway bind defaults to loopback-only unless explicit override.
- [x] Dashboard auth policy is explicitly secure by default (or requires explicit opt-out).
- [x] Deploy command executes security audit gate and fails on critical findings.
- [x] Budget tracking can key by `agentId` (no forced `_global` behavior).
- [x] Compliance and alert query paths are validated for per-agent filtering.
- [x] `ROADMAP.md` shows 2A.6 complete and includes a 2B readiness checklist.
- [x] Root test suite + typecheck pass.
- [x] Dashboard checks pass for auth/middleware paths (`pnpm check:dashboard` or equivalent targeted tests).

---

## Task 1: Lock Down Gateway Network Defaults

**Files:**
- Modify: `src/config/generate-compose.ts`
- Modify: `src/config/generate-openclaw.ts`
- Modify: `src/config/types.ts`
- Test: `test/unit/config/generate-compose.test.ts`
- Test: `test/unit/config/generate-openclaw.test.ts`
- Test: `test/unit/config/parse.test.ts`

**Step 1: Write failing tests**
- Add tests asserting generated compose uses loopback bind by default.
- Add tests asserting explicit LAN bind requires config opt-in.
- Add tests asserting OpenClaw config output reflects secure defaults.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/config/generate-compose.test.ts`
- Run: `pnpm test -- test/unit/config/generate-openclaw.test.ts`

**Step 3: Implement minimal schema + generator changes**
- Add explicit gateway exposure mode in config schema (for example, `gateway.bind` enum).
- Default to loopback in generators.
- Require explicit opt-in for LAN/custom modes.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/config/generate-compose.test.ts`
- Run: `pnpm test -- test/unit/config/generate-openclaw.test.ts`

**Step 5: Commit**
- `git add src/config/types.ts src/config/generate-compose.ts src/config/generate-openclaw.ts test/unit/config/generate-compose.test.ts test/unit/config/generate-openclaw.test.ts test/unit/config/parse.test.ts`
- `git commit -m "fix: default gateway bind to loopback for secure deployments"`

---

## Task 2: Harden Dashboard Auth Defaults for Enterprise Mode

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/generate-compose.ts`
- Modify: `README.md`
- Test: `test/unit/config/types-dashboard-auth.test.ts`
- Test: `test/unit/config/generate-compose-auth.test.ts`

**Step 1: Write failing tests**
- Assert secure behavior when dashboard enabled but auth omitted.
- Assert explicit insecure mode must be opt-in and visibly documented.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/config/types-dashboard-auth.test.ts`

**Step 3: Implement minimal policy**
- Introduce explicit config behavior for dashboard auth in enterprise mode.
- Ensure generated compose/runtime env reflects chosen policy.
- Prevent unusable deployments with an explicit bootstrap rule:
  - If dashboard auth is effectively enabled, `username` and `password` must be present and valid at config-parse time, OR
  - implement auto-generated bootstrap credentials and print one-time setup instructions.
- Pick one approach and enforce it consistently in schema, deploy flow, and docs.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/config/types-dashboard-auth.test.ts`
- Run: `pnpm test -- test/unit/config/generate-compose-auth.test.ts`
- Run: `pnpm test -- test/unit/commands/deploy.test.ts`

**Step 5: Commit**
- `git add src/config/types.ts src/config/generate-compose.ts README.md test/unit/config/types-dashboard-auth.test.ts test/unit/config/generate-compose-auth.test.ts`
- `git commit -m "fix: enforce secure dashboard auth defaults"`

---

## Task 3: Add Deploy-Time OpenClaw Security Audit Gate

**Files:**
- Modify: `src/commands/deploy.ts`
- Possibly create: `src/openclaw/security-audit.ts`
- Test: `test/unit/commands/deploy.test.ts`
- Test: `test/integration/deploy-lifecycle.test.ts`

**Step 1: Write failing tests**
- Unit test: deploy flow invokes security audit command before success.
- Unit test: deploy fails on critical audit findings.
- Integration test: mocked failing audit blocks successful deploy completion.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/commands/deploy.test.ts`

**Step 3: Implement minimal audit gate**
- Execute audit from inside the gateway container (do not require host-side `openclaw` binary).
  - Primary path: run audit command via `docker compose exec -T openclaw-gateway ...`.
  - Define exact command and expected stdout/stderr contract in implementation notes.
- Parse output/exit code and classify findings:
  - `critical` -> fail deploy
  - `warn/info` -> continue with explicit warning summary
- Provide remediation hint in CLI output.
- Implement an explicit developer bypass flag (for local iteration only), with loud warning in logs and docs.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/commands/deploy.test.ts`
- Run: `pnpm test -- test/integration/deploy-lifecycle.test.ts`

**Step 5: Commit**
- `git add src/commands/deploy.ts src/openclaw/security-audit.ts test/unit/commands/deploy.test.ts test/integration/deploy-lifecycle.test.ts`
- `git commit -m "feat: gate deployments with openclaw security audit"`

---

## Task 4: Introduce Per-Agent Budget Tracking (2B Prerequisite)

**Files:**
- Modify: `src/plugins/clawforce-router/budget-tracker.ts`
- Modify: `src/plugins/clawforce-router/index.ts`
- Modify: `src/storage/reader.ts`
- Modify: `src/storage/writer.ts` (if needed for consistency)
- Test: `test/unit/plugins/clawforce-router/budget-tracker.test.ts`
- Test: `test/unit/plugins/clawforce-router/index.test.ts`
- Test: `test/unit/storage/reader.test.ts`

**Step 1: Write failing tests**
- Budget state is independent per agent ID.
- Router budget checks pass `ctx.agentId` instead of defaulting to `_global`.
- Storage reader returns correct per-agent budget timeseries.
- Mixed historical data migration coverage:
  - legacy `_global` rows remain queryable
  - null/missing `agent_id` rows map deterministically to `_global`
  - new per-agent rows do not regress global totals.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/plugins/clawforce-router/budget-tracker.test.ts`

**Step 3: Implement minimal per-agent keying**
- Add `agentId` parameter to budget check and record methods.
- Persist/retrieve rows keyed by agent ID.
- Keep backward compatibility by mapping missing IDs to `_global`.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/plugins/clawforce-router/budget-tracker.test.ts`
- Run: `pnpm test -- test/unit/plugins/clawforce-router/index.test.ts`
- Run: `pnpm test -- test/unit/storage/reader.test.ts`

**Step 5: Commit**
- `git add src/plugins/clawforce-router/budget-tracker.ts src/plugins/clawforce-router/index.ts src/storage/reader.ts src/storage/writer.ts test/unit/plugins/clawforce-router/budget-tracker.test.ts test/unit/plugins/clawforce-router/index.test.ts test/unit/storage/reader.test.ts`
- `git commit -m "feat: add per-agent budget state tracking"`

---

## Task 5: Validate Per-Agent Compliance Scoping for 2B Dashboard Needs

**Files:**
- Modify: `src/plugins/clawforce-compliance/index.ts` (if needed)
- Modify: `src/storage/types.ts` (if needed)
- Modify: `src/storage/reader.ts`
- Test: `test/unit/plugins/clawforce-compliance/index.test.ts`
- Test: `test/unit/storage/reader.test.ts`

**Step 1: Write failing tests**
- Ensure compliance events include agent ID consistently.
- Ensure reader filters and aggregations by agent ID produce isolated outputs.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/plugins/clawforce-compliance/index.test.ts`

**Step 3: Implement minimal normalization**
- Normalize missing agent IDs consistently.
- Harden filtering/aggregation paths for multi-agent views.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/plugins/clawforce-compliance/index.test.ts`
- Run: `pnpm test -- test/unit/storage/reader.test.ts`

**Step 5: Commit**
- `git add src/plugins/clawforce-compliance/index.ts src/storage/types.ts src/storage/reader.ts test/unit/plugins/clawforce-compliance/index.test.ts test/unit/storage/reader.test.ts`
- `git commit -m "fix: normalize per-agent compliance scoping for multi-agent readiness"`

---

## Task 6: Align Credential Strategy with OpenClaw Auth Profiles (Foundation Slice)

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/generate-env.ts`
- Modify: `src/config/generate-openclaw.ts`
- Modify: `src/workspace/setup.ts`
- Test: `test/unit/config/generate-env.test.ts`
- Test: `test/unit/config/generate-openclaw.test.ts`
- Test: `test/unit/workspace/setup.test.ts`

**Step 1: Write failing tests**
- Verify no mandatory API key injection into compose env when auth profile mode is enabled.
- Verify generated config/workspace can support auth-profile-based credential path.

**Step 2: Run tests to verify failure**
- Run: `pnpm test -- test/unit/config/generate-env.test.ts`

**Step 3: Implement minimal compatibility mode**
- Introduce explicit credential mode in config (for example, `env` vs `auth_profile`).
- Keep `env` mode backward compatible.
- Add initial support for auth-profile-first flow to remove forced env propagation.
- Define and enforce precedence/validation rules:
  - If `credential_mode=env`, require `models.api_key` when cloud models require it.
  - If `credential_mode=auth_profile`, do not inject provider API keys into compose env.
  - If both are provided, define deterministic precedence and emit a warning.

**Step 4: Re-run tests**
- Run: `pnpm test -- test/unit/config/generate-env.test.ts`
- Run: `pnpm test -- test/unit/config/generate-openclaw.test.ts`
- Run: `pnpm test -- test/unit/workspace/setup.test.ts`

**Step 5: Commit**
- `git add src/config/types.ts src/config/generate-env.ts src/config/generate-openclaw.ts src/workspace/setup.ts test/unit/config/generate-env.test.ts test/unit/config/generate-openclaw.test.ts test/unit/workspace/setup.test.ts`
- `git commit -m "feat: add auth-profile credential mode for secure deployments"`

---

## Task 7: Update Readiness Docs and Roadmap Gates

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`
- Modify: `docs/plans/2026-02-16-2b-readiness-hardening-plan.md` (status updates)

**Step 1: Write failing docs checks (manual checklist)**
- Verify 2A.6 is marked complete where implementation exists.
- Add explicit 2B readiness checklist section.

**Step 2: Implement docs updates**
- Update 2A.6 status and 2A exit criteria.
- Add 2B start criteria linked to security + per-agent budget/compliance gates.
- Update README with secure deployment defaults and operational expectations.

**Step 3: Validate docs consistency**
- Cross-check config examples against current schema names.
- Ensure all CLI examples match actual commands and defaults.

**Step 4: Commit**
- `git add ROADMAP.md README.md docs/plans/2026-02-16-2b-readiness-hardening-plan.md`
- `git commit -m "docs: formalize 2b readiness gates and secure defaults"`

---

## Task 8: Final Verification Gate (Stabilization and Release Readiness)

**Files:**
- No source additions; verification only.

**Step 1: Run full verification**
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check:root`
- `pnpm check:dashboard`

**Step 2: Deploy smoke verification**
- Initialize test environment:
  - Run `clawforce deploy -c <secure-test-config.yaml>`
  - Ensure required services and env are healthy before testing behavior.
- Execute real feature path end-to-end:
  - Validate gateway/network defaults.
  - Validate dashboard auth behavior.
  - Validate security-audit gate execution and failure semantics.
  - Validate per-agent budget persistence and query behavior.
- Evaluate outputs/logs/side effects.
- If any issue appears:
  - Fix -> write/update tests -> run tests -> commit -> push
  - Repeat smoke execution until behavior matches expected outcomes.
- After smoke fixes:
  - Re-run full suite (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:root`).
  - Re-run dashboard verification (`pnpm check:dashboard`) when auth/dashboard code changed.
- Best-effort integration test:
  - Add and run explicit end-to-end integration coverage if practical.
  - If not practical, record why in PR description.

**Step 3: Record results**
- Add a short validation block in PR description:
  - test counts
  - smoke result
  - known limitations and follow-ups
- Confirm PR text has no assistant/AI attribution.

---

## Risk Register

- **Risk:** Breaking existing single-agent deploy configs.
  - **Mitigation:** Backward-compatible defaults + migration notes + parse warnings.
- **Risk:** Security audit false positives blocking local dev.
  - **Mitigation:** Add explicit developer bypass flag with warning, keep enterprise mode strict.
- **Risk:** Per-agent budget changes regress dashboard cost views.
  - **Mitigation:** Add regression tests in `storage/reader` and dashboard cost calculations.
- **Risk:** Auth-profile mode partially implemented.
  - **Mitigation:** Clearly mark phase as foundation slice; keep env mode supported until full migration.

---

## Handoff Checklist (2B Start Authorization)

- [ ] All Task 1-8 commits merged.
- [ ] 2B entry gates all checked.
- [ ] No critical or high security findings in deploy-time audit.
- [ ] Pilot config tested with 3 logical agent identities and isolated budget state.
- [ ] Roadmap and README updated to reflect actual behavior.

When all boxes are checked, start Phase `2B.1` (multi-agent schema) immediately.

---

## Suggested Branching / PR Strategy

Default strategy for this workflow is one feature branch + one draft PR from the start, with frequent commits and pushes.

If smaller review slices are needed, use incremental commits (and optional stacked PRs) only after the draft PR is created and with explicit reviewer agreement.
