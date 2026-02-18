# Clawforce: Feature Gap Backlog

**Date**: 2026-02-16
**Status**: Internal reference — pre-Phase 2B
**Context**: Comprehensive gap analysis of core platform before multi-agent orchestration work

This document captures known feature gaps discovered during the pre-2B platform audit. Items are organized by priority tier. Tier 1 items are tracked separately (active work). This document covers Tier 2+ items for future phases.

---

## Tier 2: Operational Maturity (Address in Phase 2C or 3)

### 2.1 Audit Log Retention Policies

**Current State**: Logs grow indefinitely. No rotation, purging, or archival mechanism.

**Gap**:
- JSONL files (`data/compliance.jsonl`, `data/routing.jsonl`) append forever
- SQLite tables have no automatic cleanup
- No configurable retention windows
- GDPR "right to erasure" (Article 17) requires data deletion capability

**Proposed Solution**:
```yaml
compliance:
  retention:
    days: 90              # Delete logs older than 90 days
    archive: true         # Archive to compressed files before deletion
    archive_path: ./data/archive/
```

- Background pruner runs on deploy or via `clawforce maintenance` command
- JSONL: Rotate files by date, compress old files, delete past retention window
- SQLite: `DELETE FROM compliance_events WHERE ts < ?` with batch processing
- Keep aggregated metrics even after raw log deletion (for cost dashboards)

**Files to modify**: `src/storage/writer.ts`, new `src/storage/retention.ts`, `src/config/types.ts`
**Effort**: Medium (~2-3 days)
**Phase**: 3.3 (SOC 2 preparation requires data retention policies)

---

### 2.2 Structured Logging / OpenTelemetry

**Current State**: Basic `chalk` console logger (`src/utils/logger.ts`, 11 lines). No structured output, no metrics export, no distributed tracing.

**Gap**:
- Can't integrate with Datadog, Splunk, ELK, or any observability stack
- No correlation IDs across routing decisions, compliance events, and alerts
- No performance metrics (routing latency, health check duration, budget calculation time)
- Debugging production issues requires manual log inspection

**Proposed Solution**:
- Replace `logger.ts` with structured JSON logger (e.g., `pino`)
- Add OpenTelemetry SDK for traces and metrics
- Export routing decision traces (dimensions evaluated, time per dimension, final model)
- Prometheus-compatible metrics endpoint on dashboard

**Key Metrics to Export**:
| Metric | Type | Description |
|--------|------|-------------|
| `clawforce_routing_decisions_total` | Counter | Routing decisions by dimension, model |
| `clawforce_routing_latency_ms` | Histogram | Time to evaluate routing decision |
| `clawforce_pii_detections_total` | Counter | PII detections by type |
| `clawforce_budget_spend_daily` | Gauge | Current daily spend per agent |
| `clawforce_health_check_status` | Gauge | Provider health (0=down, 1=healthy) |
| `clawforce_alerts_total` | Counter | Alerts by type and severity |

**Files to modify**: `src/utils/logger.ts`, new `src/observability/` module, dashboard metrics endpoint
**Effort**: Large (~4-5 days)
**Phase**: 3+ (enterprise customers will require observability integration)

---

### 2.3 Cascading Fallback Models

**Current State**: Single fallback model for budget exhaustion. Health failover is binary (local → cloud if non-PII).

**Gap**:
- Can't express "try Claude Sonnet → GPT-4o → local Qwen" chains
- No quality-based fallback (if primary model returns error, try next)
- No context-length-based fallback (prompt too long for primary → route to longer-context model)

**Proposed Solution**:
```yaml
routing:
  fallback_chain:
    - anthropic/claude-sonnet-4-5    # Try first
    - openai/gpt-4o                  # If Anthropic unavailable
    - sglang/qwen3-32b              # Last resort (local)
  budget_fallback_chain:
    - openai/gpt-4o-mini            # Cheap cloud
    - sglang/qwen3-32b              # Free local
```

- Router `selectModel()` returns ordered candidate list instead of single model
- Health monitor gates each candidate
- First healthy, affordable candidate wins

**Files to modify**: `src/plugins/clawforce-router/router.ts`, `src/config/types.ts`
**Effort**: Medium (~2-3 days)
**Phase**: 2C or 3 (important for production reliability)

---

### 2.4 Per-Model Configuration Overrides

**Current State**: No per-model temperature, max_tokens, or timeout settings. All models use OpenClaw defaults.

**Gap**:
- Can't set lower temperature for code generation models
- Can't set shorter timeouts for fast models (Haiku) vs slow (Opus)
- Can't configure max_tokens per model (local models may need different limits)

**Proposed Solution**:
```yaml
models:
  overrides:
    anthropic/claude-sonnet-4-5:
      temperature: 0.7
      max_tokens: 4096
      timeout_seconds: 120
    sglang/qwen3-32b:
      temperature: 0.3
      max_tokens: 2048
      timeout_seconds: 60
```

- Router passes overrides to OpenClaw via hook return value
- OpenClaw applies them to the model request

**Files to modify**: `src/config/types.ts`, `src/plugins/clawforce-router/router.ts`, `src/plugins/clawforce-router/index.ts`
**Effort**: Small (~1-2 days)
**Phase**: 2C (useful for template tuning)

---

### 2.5 SIEM / Log Export API

**Current State**: JSONL files exist but no formal export mechanism. `clawforce audit` reads them but only outputs to terminal.

**Gap**:
- Enterprises need to pipe audit data to Splunk, Elasticsearch, CloudWatch, etc.
- No machine-readable export format from the audit command
- No streaming export for real-time SIEM integration

**Proposed Solution**:
- Add `clawforce audit --format json --stream` for piping to external tools
- Add `clawforce audit --format csv` for spreadsheet analysis
- Future: webhook-based event forwarding (fires on every compliance event)

**Files to modify**: `src/commands/audit.ts`
**Effort**: Small (~1-2 days)
**Phase**: 3 (SOC 2 / enterprise compliance requirement)

---

## Tier 3: Enterprise Polish (Address in Phase 3+)

### 3.1 Encryption at Rest

**Current State**: JSONL and SQLite files stored in plaintext on disk.

**Gap**: HIPAA and GDPR recommend (but don't strictly require at app level) encryption at rest for PII-adjacent data.

**Workaround**: Use OS-level full-disk encryption (FileVault on macOS, LUKS on Linux, BitLocker on Windows). Document this as a deployment requirement.

**Future Solution**: SQLCipher for SQLite encryption, or application-level field encryption for PII-containing log entries.

**Effort**: Medium (~3 days)
**Phase**: 3.3 (SOC 2 preparation)

---

### 3.2 RBAC Beyond Admin/Viewer

**Current State**: Dashboard has two roles: `admin` (full access) and `viewer` (read-only).

**Gap**: No compliance officer role (can see PII audit logs but not modify config), no operator role (can restart agents but not view PII data).

**Proposed Roles**:
| Role | View Activity | View PII Logs | Manage Agents | Edit Config | Manage Users |
|------|:---:|:---:|:---:|:---:|:---:|
| `viewer` | Yes | No | No | No | No |
| `operator` | Yes | No | Yes | No | No |
| `compliance` | Yes | Yes | No | No | No |
| `admin` | Yes | Yes | Yes | Yes | Yes |

**Files to modify**: `src/commands/user.ts`, `src/storage/types.ts`, dashboard middleware, API routes
**Effort**: Medium (~3 days)
**Phase**: 3+ (enterprise requirement, especially regulated industries)

---

### 3.3 Response Caching

**Current State**: No caching layer. Every request goes to the model, even if the same prompt was asked minutes ago.

**Gap**: Wastes money on repeated queries, increases latency for common questions.

**Proposed Solution**: Exact-match cache with configurable TTL in SQLite. Semantic cache (embedding similarity) is Phase 4.

**Effort**: Medium (~3 days)
**Phase**: 4 (optimization, not correctness)

---

### 3.4 Load Balancing Across Local Runtimes

**Current State**: Single local model endpoint per runtime type. No multi-instance support.

**Gap**: Can't distribute inference across multiple GPU servers. Single point of failure for local inference.

**Proposed Solution**: Allow multiple endpoints per provider in config. Router round-robins across healthy endpoints.

```yaml
models:
  local:
    endpoints:
      - http://gpu-server-1:11434
      - http://gpu-server-2:11434
    strategy: round-robin  # or least-connections
```

**Effort**: Medium (~3 days)
**Phase**: 4 (scaling concern, aligns with Kubernetes deployment)
**Note**: The split architecture in INFRASTRUCTURE-DEPLOYMENT.md already conceptualizes this but the code doesn't support multiple endpoints yet.

---

### 3.5 Data Residency / Geo-Fencing

**Current State**: Router enforces local vs cloud, but no concept of geographic data policies.

**Gap**: GDPR requires data to stay in EU unless adequacy decision exists. No way to configure "EU-only cloud endpoints" or "US-only local models."

**Workaround**: Configure cloud provider endpoints at the provider level (e.g., Anthropic EU endpoint). Clawforce doesn't need to manage this directly — it's a provider configuration concern.

**Future Solution**: Add `data_residency` field to model config that validates endpoint regions.

**Effort**: Medium (~2-3 days)
**Phase**: 4+ (only needed for multi-region enterprise deployments)

---

### 3.6 Consent Management

**Current State**: No mechanism to track user consent for data processing.

**Gap**: GDPR requires explicit consent for processing personal data. No opt-in/opt-out flows.

**Workaround**: Enterprise license agreements cover consent at the organizational level. Per-user consent is typically managed by the customer's own systems, not the AI orchestration layer.

**Future Solution**: Integrate with customer's identity provider to check consent status before processing.

**Effort**: Large (~5+ days)
**Phase**: 4+ (typically handled at the customer's app layer, not the orchestration layer)

---

### 3.7 Request Queuing

**Current State**: No queue when local runtime is at capacity. Circuit breaker blocks or fails over.

**Gap**: Under heavy load, requests that could succeed with a short wait are instead immediately failed or routed to cloud.

**Note**: Config already has `failover_policy: queue` as a placeholder but it's rejected at parse time with "not implemented."

**Proposed Solution**: Simple in-memory FIFO queue with configurable max depth and timeout. If local runtime is busy, queue the request for up to N seconds before failing over.

**Effort**: Medium (~2-3 days)
**Phase**: 2B or 3 (becomes important with multiple agents competing for local runtime)

---

### 3.8 Latency-Based Routing

**Current State**: No latency tracking per provider. No SLA-aware model selection.

**Gap**: Can't route urgent/interactive requests to faster models and batch/background requests to slower but capable models.

**Future Solution**: Track P50/P99 latency per provider in health monitor. Add optional `latency` dimension to router.

**Effort**: Medium (~3 days)
**Phase**: 4+ (optimization, requires production latency data to calibrate)

---

### 3.9 Audit Log Signing / Immutability

**Current State**: JSONL files can be edited or deleted. SQLite can be modified directly. No tamper detection.

**Gap**: SOX and PCI-DSS require tamper-proof audit logs. No cryptographic proof that logs haven't been modified.

**Proposed Solution**: HMAC signature per JSONL entry using a deployment-specific secret. Verification command: `clawforce audit --verify-integrity`.

**Effort**: Small (~1-2 days for HMAC, larger for full WORM guarantees)
**Phase**: 3.3 (SOC 2 preparation)

---

### 3.10 SSO / SAML / OAuth for Dashboard

**Current State**: Dashboard uses username/password authentication via Auth.js credentials provider.

**Gap**: Enterprise customers expect SSO integration (Okta, Azure AD, Google Workspace).

**Proposed Solution**: Auth.js v5 already supports OAuth providers. Add configuration for:
```yaml
dashboard:
  auth:
    provider: oauth     # credentials | oauth | saml
    oauth:
      provider: azure-ad
      client_id: ${OAUTH_CLIENT_ID}
      client_secret: ${OAUTH_CLIENT_SECRET}
      tenant_id: ${AZURE_TENANT_ID}
```

**Effort**: Medium (~2-3 days, Auth.js does the heavy lifting)
**Phase**: 3+ (enterprise sales requirement)

---

## Tier 4: Advanced Capabilities (Phase 4+)

### 4.1 ML-Based PII Detection

Replace regex patterns with NER (Named Entity Recognition) models for higher accuracy and multi-language support. Current regex approach is solid for English but doesn't cover EU/APAC PII patterns.

### 4.2 Anomaly Detection on Audit Logs

Flag unusual patterns: sudden cost spikes, unusual PII exposure rates, agents accessing unexpected channels. Requires baseline period and statistical modeling.

### 4.3 Differential Privacy for Analytics

Add noise injection to aggregated metrics to prevent individual re-identification. Needed if analytics data is shared across tenants.

### 4.4 Privacy Impact Assessment (PIA) Automation

Generate GDPR Article 35 Data Protection Impact Assessments from deployment configuration and audit data.

### 4.5 Cross-Border Transfer Safeguards

Validate Standard Contractual Clauses (SCC) compliance when cloud models are in different jurisdictions than users.

### 4.6 Secrets Management Integration

Integrate with HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault instead of `.env` files. Includes key rotation and secrets audit logging.

### 4.7 Plugin Sandboxing

Run plugins in isolated V8 contexts or separate processes to prevent a buggy plugin from crashing the gateway.

### 4.8 Plugin Versioning and Hot-Reload

Version plugins independently from the platform. Support hot-reload without gateway restart.

---

## Relationship to Roadmap Phases

| Gap | Recommended Phase | Rationale |
|-----|------------------|-----------|
| Audit log retention | 3.3 (SOC 2) | Required for compliance certification |
| Structured logging / OTel | 3+ | Enterprise observability requirement |
| Cascading fallbacks | 2C or 3 | Production reliability |
| Per-model overrides | 2C | Template tuning |
| SIEM export | 3 | Enterprise compliance |
| Encryption at rest | 3.3 (SOC 2) | Compliance certification |
| RBAC expansion | 3+ | Enterprise access control |
| Response caching | 4 | Cost optimization |
| Load balancing | 4 | Scaling (Kubernetes phase) |
| Data residency | 4+ | Multi-region enterprise |
| `audit.ts` coverage (49.57%) | Before/during 2B | Supervisor queries audit data |
| `writer.ts` coverage (78.94%) | Before/during 2B | Multi-agent concurrent writes |
| `engines/registry.ts` no test file | Before/during 2B | Multi-agent compose changes |
| Request queuing | 2B or 3 | Multi-agent competition for resources |
| Audit log signing | 3.3 (SOC 2) | Tamper-proof audit trail |
| SSO/OAuth | 3+ | Enterprise sales requirement |
| ML-based PII | 4+ | Multi-language, higher accuracy |
| Anomaly detection | 4+ | Advanced security monitoring |
| Secrets management | 4+ | Enterprise key management |

---

## Tier 1.5: Test Coverage Gaps (Address Before or During 2B)

These modules have lower-than-target test coverage identified during the pre-2B audit (2026-02-16, 929 tests passing). They aren't blocking 2B start but should be addressed as those files are touched for multi-agent work.

### 1.5.1 `src/commands/audit.ts` — 49.57% Line Coverage

**Gap**: Database audit filtering paths (lines 85, 191-253, 269) are uncovered. The `--source database` flow with `--since`, `--event`, `--agent`, and `--pii-only` flags lacks unit tests.

**Why it matters for 2B**: The supervisor agent will query audit data heavily. Untested filter paths risk regressions when adding per-agent scoping.

**Fix**: Add tests for database source filtering in `test/unit/commands/audit.test.ts`.

**Effort**: Small (~0.5-1 day)

---

### 1.5.2 `src/storage/writer.ts` — 78.94% Line Coverage

**Gap**: Lines 77-82 and 153 are uncovered — likely error handling paths during write operations.

**Why it matters for 2B**: Multi-agent deployments will have concurrent writes from multiple agents. Write failure paths need to be validated.

**Fix**: Add error condition tests in `test/unit/storage/writer.test.ts`.

**Effort**: Small (~0.5 day)

---

### 1.5.3 `src/config/engines/registry.ts` — No Dedicated Test File

**Gap**: The runtime engine registry (Ollama, vLLM, SGLang container service generation and health check logic) has 95% coverage from indirect tests but no dedicated test file. Complex logic for probe URL generation, container port mapping, and GPU flags is only tested as a side effect of compose generation tests.

**Why it matters for 2B**: Multi-agent compose generation may change how engine services are configured. Without isolated tests, regressions in engine behavior could be masked by higher-level test changes.

**Fix**: Create `test/unit/config/engines/registry.test.ts` with direct tests for each engine's service generation and health probe logic.

**Effort**: Small (~0.5 day)

---

## Notes

- **PRICING-OPTIONS.md** and **INFRASTRUCTURE-DEPLOYMENT.md** provide business context for prioritization
- The self-hosted license model (Option 2 in pricing) means customers manage their own infrastructure — many "enterprise gaps" (encryption, secrets, SSO) can be deferred because customers bring their own solutions
- The split architecture deployment model means some gaps (load balancing, latency routing) are more relevant for customers running their own GPU infrastructure
- Phase 3.3 (SOC 2 preparation) is the natural consolidation point for most compliance-related gaps
