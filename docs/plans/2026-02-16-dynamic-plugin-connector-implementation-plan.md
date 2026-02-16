# Dynamic Plugin and Connector Architecture Implementation Plan

**Date**: 2026-02-16  
**Status**: Ready for implementation  
**Depends on**: `docs/plans/2026-02-16-dynamic-plugin-connector-architecture-plan.md`  
**Primary Goal**: Replace static first-party plugin wiring with a secure, dynamic, provider-neutral plugin/connector platform for Claudebot agents in Clawforce.

## Overview

This plan translates the approved architecture into concrete implementation phases with exact file targets, expected interfaces, and verification gates. It is designed to be executed directly by an engineer with no additional interpretation.

## Current State Analysis

Clawforce currently:

- Hardcodes plugin IDs in `src/plugins/compiler.ts`
- Hardcodes plugin entries in `src/config/generate-openclaw.ts`
- Uses permissive plugin manifests with minimal schema
- Uses loose plugin hook/context contracts (`Record<string, unknown>`)
- Supports Slack and Telegram channel config but lacks full connector-neutral runtime context for plugin policy and logging paths

## Desired End State

At completion:

1. Plugin discovery and enablement are dynamic.
2. Manifest/config contracts are validated before runtime activation.
3. Plugin permissions and secret-reference policy are enforced centrally.
4. Connector context is provider-neutral for Slack/Telegram and extensible for future connectors.
5. Plugin runtime lifecycle is standardized with failure containment and diagnostics.
6. Existing router/compliance behavior and safety invariants remain intact.

## What We Are NOT Doing

- Public plugin marketplace
- Cryptographic plugin signing/provenance verification
- External process sandboxing for plugins
- OpenClaw runtime internals rewrite
- Full multi-tenant control plane features

## Mandatory Workflow (Blocking)

This work is non-trivial and must follow:

`Research -> Plan -> Plan Review -> Branch + Draft PR -> Implement (Write/Test/Commit/Push each phase) -> Code Review -> Fix -> Smoke Test -> Documentation -> PR Ready`

### First Execution Step (Blocking)

Before any implementation code:

```bash
git checkout main
git pull
git checkout -b feat/dynamic-plugin-connector-architecture
git push -u origin feat/dynamic-plugin-connector-architecture
gh pr create --draft --base main --title "feat: dynamic plugin and connector architecture"
```

No implementation coding starts before this completes.

### Workflow Compliance Matrix (Must Follow Exactly)

This implementation must satisfy each workflow rule below without exception:

1. **Research first**
   - Task 1 artifact must be created and committed before Task 3.
2. **Plan review before branch and code**
   - Task 2 sub-agent review must complete, and findings must be folded into docs before Task 3.
3. **Branch + draft PR before implementation**
   - Task 3 must complete before any code changes for Tasks 4-8.
4. **Write -> Test -> Commit -> Push per phase**
   - Each phase must include test updates, green test runs, commit, and push before moving forward.
5. **Code review + fixes before smoke test**
   - Task 9 must complete before Task 10.
6. **Smoke test before PR ready**
   - Task 10 must complete before Task 12.
7. **Docs before PR ready**
   - Task 11 must complete before Task 12.
8. **PR ready only when all gates are green**
   - `gh pr ready` only after all required checks are passing.

### Task Status Tracking (Required)

Track each task with explicit state transitions:

- `pending -> in_progress -> completed`

At most one task should be marked `in_progress` at a time.

## Task Checklist (Execution Order)

### Task 1: Research Artifact (Required)

Create and commit:

- `docs/plans/2026-02-16-plugin-connector-interface-inventory.md`

Must include:

- Plugin and connector touchpoints
- Hook contracts currently consumed by router/compliance
- Migration boundaries and replacement risks

### Task 2: Plan Review Artifact (Required)

- Dispatch review sub-agent for this implementation plan + Task 1 inventory
- Resolve findings and update both docs before Task 3

### Task 3: Branch + Draft PR (Required, first execution step)

- Run branch + draft PR commands above
- Add phase checklist and test matrix to PR body

### Task 4+: Implement phases below, in order, with test/commit/push per phase

## Phase 1: Plugin Registry and Dynamic Discovery

### Changes Required

- `src/plugins/compiler.ts`
- New `src/plugins/registry.ts`
- `src/commands/plugins-watch.ts`
- `src/config/generate-openclaw.ts`

### Implementation Details

1. Create a registry module that discovers plugin manifests from known plugin roots.
2. Parse and validate minimal manifest identity fields early.
3. Enforce deterministic ordering by plugin `id`.
4. Fail on duplicate IDs with actionable error.
5. Replace hardcoded plugin arrays with registry-discovered IDs.

### Proposed Types

```ts
export interface DiscoveredPlugin {
  id: string;
  manifestPath: string;
  entryPath: string;
  sourceDir: string;
  manifest: OpenClawPluginManifest;
}

export interface PluginDiscoveryOptions {
  roots: string[];
  include?: string[];
  exclude?: string[];
}
```

### Success Criteria

#### Automated Verification

- [ ] Unit tests: discovery success, missing manifest, malformed manifest, duplicate IDs, deterministic order
- [ ] Integration test: enabling discovered plugin without modifying source plugin lists

#### Manual Verification

- [ ] Add temporary test plugin directory and confirm build/watch includes it
- [ ] Existing router/compliance still bundle and load

## Phase 2: Manifest Contract and Config Validation

### Changes Required

- New `src/plugins/manifest-schema.ts`
- `src/plugins/clawforce-router/openclaw.plugin.json`
- `src/plugins/clawforce-compliance/openclaw.plugin.json`
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`

### Implementation Details

1. Define a strict manifest schema:
   - `id`
   - `version`
   - `engines` (required OpenClaw/Clawforce range)
   - `capabilities`
   - `permissions`
   - `configSchema`
2. Validate manifests during discovery and deployment preparation.
3. Validate user plugin config against plugin `configSchema`.
4. Enforce strict manifest mode:
   - Missing required fields -> hard failure
   - Invalid schema or missing identity/version -> hard failure

### Proposed Contract

```ts
export interface OpenClawPluginManifest {
  id: string;
  version: string;
  engines?: {
    clawforce?: string;
    openclaw?: string;
  };
  capabilities?: string[];
  permissions?: string[];
  configSchema: Record<string, unknown>;
}
```

### Success Criteria

#### Automated Verification

- [ ] Unit tests: manifest pass/fail matrix
- [ ] Tests: configSchema validation pass/fail
- [ ] Tests: strict hard-fail behavior for malformed manifests

#### Manual Verification

- [ ] Invalid manifest/config yields clear actionable messages
- [ ] Existing first-party plugin config remains functional

## Phase 3: Permission Model and Secret Boundary

### Changes Required

- New `src/plugins/permissions.ts`
- New `src/plugins/security-policy.ts`
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`
- `src/plugins/clawforce-router/index.ts`
- `src/plugins/clawforce-compliance/index.ts`

### Trust Model (This Phase)

- First-party plugins: trusted by default.
- Third-party plugins: disabled by default until explicitly enabled.
- Trust is config-driven in this phase (no cryptographic signing yet).

### Secret Policy

Sensitive plugin config values must use canonical references:

```json
{ "env": "VAR_NAME" }
```

Plaintext sensitive values are rejected where policy requires references.

### Implementation Details

1. Define permission set and default-deny policy.
2. Enforce permissions centrally before plugin activation.
3. Resolve secret references through validation/resolution layer.
4. Reject policy violations before runtime start.

### Success Criteria

#### Automated Verification

- [ ] Tests: denied permission blocks activation/operation
- [ ] Tests: secret reference resolution success/failure
- [ ] Tests: plaintext secret rejection where required

#### Manual Verification

- [ ] Security policy violations are explicit and easy to fix
- [ ] Secure existing configs continue to deploy

## Phase 4: Connector Context Abstraction

### Changes Required

- New `src/connectors/types.ts`
- New `src/connectors/normalize-context.ts`
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`
- `src/plugins/clawforce-router/data-policy.ts`
- `src/plugins/clawforce-router/index.ts`
- `src/plugins/clawforce-compliance/index.ts`

### Implementation Details

1. Create connector-neutral context model:
   - provider
   - conversation identifier
   - actor identifier
   - raw provider metadata
2. Normalize Slack and Telegram events into this context.
3. Update policy tier lookup to use normalized context.
4. Enforce normalized connector behavior and update tests to the new contract.

### Proposed Types

```ts
export interface ConnectorContext {
  provider: "slack" | "telegram" | string;
  conversationId?: string;
  actorId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}
```

### Success Criteria

#### Automated Verification

- [ ] Tests: Slack normalization under new connector contract
- [ ] Tests: Telegram normalization under new connector contract
- [ ] Tests: provider-neutral policy resolution

#### Manual Verification

- [ ] Existing Slack routing/compliance results are unchanged
- [ ] Telegram flow remains functional

## Phase 5: Plugin Runtime Lifecycle and Failure Containment

### Changes Required

- New `src/plugins/runtime.ts`
- `src/plugins/compiler.ts`
- `src/commands/deploy.ts`
- `src/commands/plugins-watch.ts`

### Implementation Details

1. Centralize plugin activation/deactivation flow.
2. Wrap plugin lifecycle and hook registration with error containment.
3. Track plugin runtime health state and expose diagnostics.
4. Ensure one plugin failure does not disable healthy plugins.

Note: isolation in this phase is in-process containment and health reporting, not separate process sandboxing.

### Success Criteria

#### Automated Verification

- [ ] Tests: activation failure containment
- [ ] Tests: runtime error handling and health transitions
- [ ] Tests: unaffected plugins remain operational when one fails

#### Manual Verification

- [ ] Deliberately broken plugin does not collapse full plugin system
- [ ] Failure diagnostics are visible via status/audit surfaces

## Testing Strategy

## Unit Test Matrix

- Discovery/registry behavior
- Manifest/config validation behavior
- Permission policy checks
- Secret reference resolution
- Connector normalization
- Lifecycle containment behavior

## Integration Test Matrix

- Dynamic plugin enablement and config generation
- Permission/secret gate enforcement through deploy path
- End-to-end hook execution with normalized connector context
- Router/compliance behavior validated against new connector contract

## Smoke Test Matrix

Use `test/SMOKE_TEST.md` plus dynamic-plugin extensions:

- Dynamic discovery and enablement
- Secure activation
- Hook execution (router + compliance)
- PII invariant preserved
- Compliance logs and audits intact
- Plugin disable/uninstall behavior

## Per-Phase Gate (Blocking)

For each implementation phase:

1. Write/update tests for phase scope
2. Run phase-relevant tests
3. Fix failures
4. Commit only when green
5. Push to draft PR branch

If a phase fails tests or checks, do not continue to the next phase until fixed and re-verified.

## Final Verification Commands

Run before `gh pr ready`:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:smoke
pnpm typecheck
pnpm build
pnpm check:security
```

## Documentation Requirements Before PR Ready

Update:

- `README.md` (dynamic plugin model, secure config examples)
- Relevant docs under `docs/` for plugin/connector configuration and operations

## PR Ready Criteria

All must be true:

- [ ] Task 1 and Task 2 artifacts completed and committed
- [ ] Branch + draft PR created before implementation code
- [ ] All phases completed with tests and per-phase commits
- [ ] Code review findings addressed
- [ ] Smoke tests passed
- [ ] Documentation updated
- [ ] CI gates green
- [ ] PR moved from draft to ready
