# Dynamic Plugin and Connector Architecture Plan

**Date**: 2026-02-16  
**Status**: Planning  
**Scope**: Replace current static plugin wiring with a secure, generic, extensible plugin/connector system for Claudebot agents in Clawforce.

## Overview

Clawforce currently ships with two first-party OpenClaw plugins (`clawforce-router`, `clawforce-compliance`) and static wiring in config generation and plugin compilation. This works for first-party features but does not meet the product goal of dynamically supporting many connectors/tools/plugins across different Claudebot agent deployments.

This plan defines a complete migration from static plugin coupling to a generic, policy-driven plugin and connector platform that is:

1. Dynamic (discovery + registration, not hardcoded IDs)
2. Secure (trust model, permission model, secret boundaries, isolation)
3. Operable (install/enable/configure/upgrade workflows)
4. Compatible with existing router/compliance behavior and safety invariants

## Current State Analysis

### What Exists Today

- Static plugin list in `src/plugins/compiler.ts` (`clawforce-router`, `clawforce-compliance`)
- Static plugin entries generated in `src/config/generate-openclaw.ts`
- Channel config supports Slack and Telegram in `src/config/types.ts` and `src/config/generate-openclaw.ts`
- Plugin manifests are minimal (`openclaw.plugin.json` with permissive `additionalProperties`)
- Router and compliance plugin APIs rely on loose hook/context contracts (`Record<string, unknown>`)

### Gaps Against Product Direction

- No dynamic plugin discovery/registration path
- No plugin engine/version enforcement checks
- No plugin permission/capability declaration
- No plugin trust verification policy
- No explicit connector abstraction layer for provider-neutral channel/resource identity
- No centralized plugin lifecycle management (install, enable/disable, validate, health)

## Desired End State

Clawforce can manage and run any OpenClaw plugin or connector through a generic platform:

1. Plugin discovery is dynamic from configured directories/registries.
2. Plugin manifests declare identity, version, required capabilities, and config schema.
3. Clawforce strictly validates manifest/config/engine requirements before activation.
4. Plugins receive only explicitly granted permissions and secret references.
5. Connector contexts are provider-neutral (Slack, Telegram, future channels/tools).
6. Existing Clawforce safety guarantees (PII, compliance, budget, health) remain enforced.

## Terminology

- **Plugin**: An OpenClaw extension loaded from a manifest and registered hooks (for example, `clawforce-router` and `clawforce-compliance`).
- **Connector**: A provider integration identity (channel or tool surface), such as Slack workspace channels, Telegram chats, and future external tool providers.
- **Connector context**: A provider-neutral representation of channel, actor, and conversation metadata that plugins use for routing, policy, and logging decisions.

## What We Are NOT Doing

- Building a public marketplace UI in this phase
- Implementing paid distribution/revenue-sharing mechanics
- Replacing OpenClaw runtime internals
- Expanding into full multi-tenant control plane work
- Rewriting router/compliance core behavior beyond interface adaptation

## Mandatory Development Workflow (Execution Contract)

This implementation is non-trivial and must follow the required workflow exactly:

`Research -> Plan -> Plan Review -> Branch + Draft PR -> Implement (Write/Test/Commit/Push per phase) -> Code Review -> Fix -> Smoke Test -> Documentation -> PR Ready`

### First Action Rule (Blocking)

Before writing implementation code, the first execution step is:

1. Create a new branch from up-to-date `main`
2. Push branch
3. Open draft PR

Required command sequence:

```bash
git checkout main
git pull
git checkout -b feat/dynamic-plugin-connector-architecture
git push -u origin feat/dynamic-plugin-connector-architecture
gh pr create --draft --base main --title "feat: dynamic plugin and connector architecture"
```

No implementation code starts before this completes.

## Execution Task List (Required)

### Task 1: Research and Interface Inventory

- Enumerate all plugin and connector touchpoints
- Document OpenClaw hook contracts used by current plugins
- Define migration boundary for router/compliance
- Deliverable: create and commit `docs/plans/2026-02-16-plugin-connector-interface-inventory.md` before Task 3

### Task 2: Plan Review (Sub-agent)

- Review this plan and Task 1 interface inventory for:
  - Missing edge cases
  - Replacement risk
  - Security gaps
  - Test coverage gaps
- Fold in review updates before branch/implementation starts, then update both plan and inventory artifacts as needed

### Task 3: Branch + Draft PR (First Execution Step)

- Execute branch and draft PR workflow above
- Add phased checklist to PR body

### Task 4: Implement Phase 1 - Plugin Registry and Discovery

- Add discovery service for plugin manifests
- Replace hardcoded plugin lists with registry output
- Add strict engine/version validation gate
- Add tests
- Commit and push

### Task 5: Implement Phase 2 - Manifest and Config Validation

- Define manifest contract fields (id, version, engine constraints, capabilities, config schema)
- Validate plugin config before deployment/generation
- Fail fast with actionable errors
- Add tests
- Commit and push

### Task 6: Implement Phase 3 - Permission and Secret Boundary

- Define permission model and enforce in activation path
- Convert sensitive values to secret references where applicable
- Add policy checks for unsafe plugin configuration
- Add tests
- Commit and push

### Task 7: Implement Phase 4 - Connector Abstraction Layer

- Introduce provider-neutral connector context model
- Adapt Slack and Telegram mapping to abstraction
- Enforce the new connector contract for all deployments
- Add tests
- Commit and push

### Task 8: Implement Phase 5 - Runtime Lifecycle and Isolation

- Add standardized plugin lifecycle handling and error isolation
- Add plugin health state tracking
- Ensure one plugin failure does not destabilize others
- Add tests
- Commit and push

### Task 9: Code Review (Sub-agent)

- Full review of implementation and tests
- Address findings in separate commits
- Push fixes

### Task 10: Smoke Test Loop

- Run the smoke checklist in `test/SMOKE_TEST.md` (or a documented superset) covering:
  - Dynamic plugin discovery and enablement
  - Secure activation with permission and secret enforcement
  - Hook execution and router/compliance behavior under the new connector contract
- Validate logging and audit output
- Fix and rerun until stable
- Re-run full test suite
- Commit and push any fixes

### Task 11: Documentation Update

- Update `README.md` and relevant `docs/` files for:
  - Dynamic plugin model
  - Configuration examples
  - Security model and permission examples
- Commit and push

### Task 12: Open PR

- Mark PR ready (`gh pr ready`, or equivalent GitHub UI action) only after all gates pass and CI is green
- Finalize PR summary and test evidence

## Phase Plan

## Phase 1: Plugin Registry and Discovery

### Changes Required

- `src/plugins/compiler.ts`
- New `src/plugins/registry.ts`
- `src/config/generate-openclaw.ts`
- `src/commands/plugins-watch.ts`

### Implementation Notes

- Replace compile-time plugin list with manifest discovery from plugin directories
- Build output only for discovered + enabled plugins
- Add deterministic ordering by plugin manifest `id` and explicit duplicate-ID failures

### Success Criteria

#### Automated Verification

- [ ] Unit tests for discovery, duplicate detection, missing manifest handling
- [ ] Integration test proving plugin enablement without editing source lists

#### Manual Verification

- [ ] Add a test plugin directory and confirm it is discovered and included
- [ ] Confirm first-party router/compliance still load

## Phase 2: Manifest and Config Contracts

### Changes Required

- `src/plugins/clawforce-router/openclaw.plugin.json`
- `src/plugins/clawforce-compliance/openclaw.plugin.json`
- New `src/plugins/manifest-schema.ts`
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`

### Implementation Notes

- Introduce explicit manifest contract fields (identity, capabilities, schema, version constraints)
- Validate plugin config against schema at generation/deploy time
- Enforce strict manifest schema requirements with hard failures
- Compatibility mode behavior:
  - Missing non-critical manifest fields produces deprecation warnings during load
  - Invalid schema shape or missing identity/version fields is a hard failure

### Success Criteria

#### Automated Verification

- [ ] Unit tests for schema validation failures and success cases
- [ ] Tests for engine/version rejection and strict schema failure behavior

#### Manual Verification

- [ ] Invalid config produces actionable, specific error output
- [ ] Valid config paths remain straightforward for end users

## Phase 3: Security Model (Permissions + Secrets)

### Changes Required

- New `src/plugins/permissions.ts`
- New `src/plugins/security-policy.ts`
- `src/config/generate-openclaw.ts`
- `src/plugins/clawforce-router/index.ts`
- `src/plugins/clawforce-compliance/index.ts`

### Implementation Notes

- Enforce explicit permission grants by plugin ID
- Keep sensitive credentials out of plain plugin config payloads
- Use a canonical secret reference format with strict validation:
  - `{ "env": "VAR_NAME" }` for sensitive plugin config values
  - Plaintext sensitive values are rejected where policy requires references
  - Enforcement occurs in config validation and `src/config/generate-openclaw.ts`
- Preserve deployment security gate behavior

### Trust Model

- First-party plugins are trusted by default.
- Third-party plugins are denied by default and require explicit enablement in config.
- Plugin trust in this phase is config-driven; cryptographic signing and provenance verification are out of scope for this implementation phase.

### Success Criteria

#### Automated Verification

- [ ] Tests proving denied permissions block activation/operation
- [ ] Tests proving plaintext secret flow is rejected where policy requires references

#### Manual Verification

- [ ] Security audit output clearly reports policy violations
- [ ] Existing secure configs continue to deploy

## Phase 4: Connector Abstraction

### Changes Required

- New `src/connectors/types.ts`
- New `src/connectors/normalize-context.ts`
- `src/config/types.ts`
- `src/config/generate-openclaw.ts`
- `src/plugins/clawforce-router/data-policy.ts`
- `src/plugins/clawforce-router/index.ts`
- `src/plugins/clawforce-compliance/index.ts`

### Implementation Notes

- Introduce provider-neutral identifiers for channel, actor, and conversation scope
- Adapt policy tier resolution to normalized connector context
- Remove Slack-specific assumptions from core routing/compliance paths
- Keep the abstraction general enough for both channel connectors and future tool/API connectors

### Success Criteria

#### Automated Verification

- [ ] Tests for Slack and Telegram mapping under normalized connector context contract
- [ ] Policy resolution tests using connector-agnostic identifiers

#### Manual Verification

- [ ] Same routing/compliance outcomes for existing Slack flows
- [ ] Telegram behavior remains functional and predictable

## Phase 5: Runtime Lifecycle and Operational Reliability

### Changes Required

- New `src/plugins/runtime.ts`
- `src/plugins/compiler.ts`
- `src/commands/deploy.ts`
- `src/commands/plugins-watch.ts`

### Implementation Notes

- Standardize activation/deactivation/error handling for plugins
- Isolate plugin failures with in-process error containment and health reporting (not separate-process sandboxing in this phase)
- Add plugin diagnostics for status/audit visibility

### Success Criteria

#### Automated Verification

- [ ] Tests for plugin activation failures and graceful degradation
- [ ] Tests for lifecycle transitions and health reporting

#### Manual Verification

- [ ] Deliberately broken plugin does not take down other plugins
- [ ] Operators can quickly identify failing plugin and reason

## Testing Strategy

### Unit Tests

- Registry/discovery logic
- Manifest/config validation
- Permission checks
- Connector normalization
- Lifecycle error handling

### Integration Tests

- End-to-end config generation with dynamic plugins
- Security policy enforcement with real plugin entries
- Multi-connector context routing/compliance flows

### Smoke Tests

- Dynamic plugin install/enable path
- Plugin activation and hook execution
- PII invariants and compliance logging intact
- Disable/uninstall plugin path

## Risks and Mitigations

- **Risk**: Breaking current deployments with strict manifest contracts  
  **Mitigation**: Provide one-shot migration tooling and explicit conversion guidance.

- **Risk**: Overly permissive fallback path undermines security intent  
  **Mitigation**: Default deny on permissions and explicit policy exceptions only.

- **Risk**: Connector abstraction introduces behavior drift  
  **Mitigation**: Contract tests for normalized connector semantics and route-test checks.

## Deliverables

1. Dynamic plugin registry and discovery path
2. Enforced manifest and config contracts
3. Plugin permission and secret boundary enforcement
4. Connector abstraction across current channels
5. Runtime lifecycle and failure isolation model
6. Updated docs with clear examples for plugin/connector onboarding

## Final Gate Before PR Ready

All of the following must be complete before `gh pr ready`:

- [ ] All phased tasks implemented with tests
- [ ] Sub-agent code review completed and fixes pushed
- [ ] Smoke test loop completed successfully
- [ ] Documentation updated
- [ ] Full verification suite green

## Pre-Implementation Checklist (Blocking)

Before Task 3 (Branch + Draft PR):

- [ ] Task 1 deliverable committed: `docs/plans/2026-02-16-plugin-connector-interface-inventory.md`
- [ ] Task 2 plan review completed and findings folded into this plan
- [ ] Terminology and trust model sections finalized in this plan

## Per-Phase Success Gate (Blocking)

Each implementation phase (Tasks 4-8) must satisfy all of the following before proceeding:

- [ ] Unit tests added or updated and passing
- [ ] No new lint or typecheck failures
- [ ] Phase changes committed and pushed to the draft PR branch
- [ ] Phase automated and manual success criteria completed
