# SQLite Storage Layer — Implementation Plan

**Date**: 2026-02-15
**Phase**: 2A.1 (Foundation for all Phase 2A+ work)
**Status**: Planned
**Branch**: `feat/sqlite-storage-layer`
**Dependencies**: None (this is a leaf dependency — other Phase 2A items depend on this)

---

## Overview

Replace Clawforce's file-based storage (JSONL logs, JSON budget state) with an embedded SQLite database using Node.js built-in `node:sqlite`. JSONL continues as a write-ahead log for durability and SIEM export. SQLite becomes the queryable backing store for the dashboard, audit command, usage metering, and future billing.

**Why now**: Dashboard auth (2A.2), real-time streaming (2A.3), alerts (2A.5), and multi-agent views (2B.3) all need queryable, indexed data. Building on top of JSONL file parsing for all of these would compound the problem.

**Why SQLite**: Zero external dependencies (uses `node:sqlite` built into Node.js 22+, same as OpenClaw's memory system), zero infrastructure, zero configuration for the end user. Scales to millions of rows. Swappable for Postgres in Phase 4 if needed.

---

## Current State Analysis

### Current Write Paths (What We're Replacing)

| Writer | File | Format | Location |
|--------|------|--------|----------|
| `clawforce-compliance/index.ts:97-110` | `compliance.jsonl` | JSONL append | `appendFileSync()` via `writeEntry()` |
| `clawforce-router/index.ts:357-371` | `routing.jsonl` | JSONL append | `appendFileSync()` via `writeRoutingLog()` |
| `budget-tracker.ts:125-132` | `budget-state.json` | JSON overwrite | `writeFileSync()` via `saveState()` |

### Current Read Paths (What We're Migrating)

| Reader | Source | Method |
|--------|--------|--------|
| Dashboard `/api/activity` (`activity/route.ts:9-36`) | `compliance.jsonl` | `readFile()` -> `parseJsonl()` -> filter in JS |
| Dashboard `/api/cost` | OpenClaw gateway WebSocket | `gatewayRequest("usage.cost")` — **not changing** |
| Dashboard `/api/status` | `docker ps` command | `execFileAsync("docker")` — **not changing** |
| Dashboard `log-parser.ts` | JSONL content string | `parseJsonl()`, `filterByEvent()`, `filterByTimeRange()`, etc. |
| CLI `audit` command (`audit.ts:125-149`) | `compliance.jsonl` or `docker logs` | File read or container exec |
| `BudgetTracker` (`budget-tracker.ts:112-123`) | `budget-state.json` | `readFileSync()` -> `JSON.parse()` |

**Not changing**: Cost route (gateway WebSocket) and status route (Docker exec) stay as-is.

### Existing Patterns to Preserve

1. **Best-effort logging** — both plugins catch write errors and log to stderr without crashing the agent
2. **Directory caching** — `ensureComplianceLogDir()` and `ensureRoutingLogDir()` only `mkdirSync` once, with exported `reset*Cache()` for testing
3. **Hook return pattern** — router returns `{ prependContext, modelOverride, providerOverride }` or `void`
4. **JSONL resilience** — `parseJsonl()` skips malformed lines without throwing

---

## Desired End State

- All compliance events, routing decisions, and budget state stored in SQLite (`clawforce.db`)
- JSONL files continue to be written alongside (dual-write)
- Dashboard API routes query SQLite instead of parsing full JSONL files
- CLI `audit` command gains `--since`, `--event`, `--agent`, `--pii-only` flags backed by SQL
- `clawforce migrate` command backfills existing JSONL data into SQLite
- All 590+ existing tests still pass, 80% coverage maintained
- New storage module has its own comprehensive tests

---

## Schema Design

### Tables

```sql
-- Compliance events: tool calls, messages, session events
CREATE TABLE IF NOT EXISTS compliance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                    -- ISO 8601 timestamp
  event TEXT NOT NULL,                 -- 'tool_call' | 'message_received' | 'message_sent' | etc.
  agent_id TEXT,                       -- which agent generated this event
  channel TEXT,                        -- message provider (slack, telegram, etc.)
  data TEXT NOT NULL,                  -- full JSON payload (flexible schema)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_ts ON compliance_events(ts);
CREATE INDEX IF NOT EXISTS idx_compliance_event ON compliance_events(event);
CREATE INDEX IF NOT EXISTS idx_compliance_agent ON compliance_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_compliance_event_ts ON compliance_events(event, ts);

-- Routing decisions: model selection, PII detection, dimension scores
CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  agent_id TEXT,
  selected_model TEXT NOT NULL,        -- final model chosen
  selected_provider TEXT,              -- provider (ollama, anthropic, etc.)
  has_pii INTEGER NOT NULL DEFAULT 0,  -- boolean: PII detected
  pii_types TEXT,                      -- JSON array of PII types found
  complexity TEXT,                     -- 'low' | 'medium' | 'high'
  domain TEXT,                         -- 'code' | 'writing' | 'analysis' | etc.
  data_tier TEXT,                      -- 'restricted' | 'confidential' | 'internal' | 'public'
  is_local INTEGER NOT NULL DEFAULT 0, -- boolean: routed to local model
  estimated_cost REAL DEFAULT 0,       -- estimated cost in USD
  data TEXT NOT NULL,                  -- full JSON payload
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_routing_ts ON routing_decisions(ts);
CREATE INDEX IF NOT EXISTS idx_routing_agent ON routing_decisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_routing_model ON routing_decisions(selected_model);
CREATE INDEX IF NOT EXISTS idx_routing_pii ON routing_decisions(has_pii);

-- Usage metrics: per-agent, per-model token counts for billing
CREATE TABLE IF NOT EXISTS usage_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL,
  provider TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  is_local INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_metrics(ts);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_metrics(model);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_metrics(date(ts));

-- Budget state: replaces budget-state.json
CREATE TABLE IF NOT EXISTS budget_state (
  agent_id TEXT NOT NULL DEFAULT '_global',
  date TEXT NOT NULL,                  -- YYYY-MM-DD
  spent REAL NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, date)
);

-- Alerts: history of fired alerts (for Phase 2A.5)
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  severity TEXT NOT NULL,              -- 'critical' | 'warning' | 'info'
  type TEXT NOT NULL,                  -- 'pii_violation' | 'budget_exceeded' | 'model_down' | etc.
  agent_id TEXT,
  message TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  data TEXT,                           -- full JSON payload
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Design Decisions

- **`data TEXT` column**: Every table has a `data` column storing the full JSON payload. This gives us flexibility to add fields without schema migrations. Indexed columns extract the most-queried fields for fast lookups.
- **`agent_id` on everything**: Ready for multi-agent (Phase 2B) from day one. Default `'_global'` for single-agent mode.
- **`alerts` table**: Schema is defined now but only populated in Phase 2A.5 (Alert System). Having the table ready means alerts can start writing immediately.
- **`usage_metrics` table**: Populated from routing decisions. This is the foundation for Phase 3 billing — we start collecting data now.

---

## What We're NOT Doing

- **Not replacing JSONL**: JSONL stays as a write-ahead log. It's durable, portable, and useful for SIEM export. SQLite is the query layer on top.
- **Not adding Postgres**: Overkill for single-tenant pilot deployments. SQLite handles millions of rows.
- **Not touching OpenClaw's storage**: OpenClaw's session store, transcripts, and memory/RAG system are untouched. We only manage Clawforce's operational data.
- **Not building a full ORM**: Raw `node:sqlite` with prepared statements. No Prisma, Drizzle, or Knex.
- **Not adding connection pooling**: SQLite in WAL mode handles concurrent reads natively. Single writer is fine for our throughput.
- **Not migrating cost data**: Cost tracking stays on the OpenClaw gateway WebSocket. We're not duplicating that data.

---

## Implementation Phases

Each phase follows the **Write → Test → Commit → Push** cycle. Tests must pass before committing. Pre-commit hooks (format, lint, typecheck, knip, tests) must pass on every commit.

---

### Phase 1: Storage Types + Database Module

**Goal**: Create the foundational storage types and SQLite database connection with schema migrations.

#### Unit 1A: Storage Types (`src/storage/types.ts`)

**New file**: `src/storage/types.ts`

```typescript
import type { ComplianceEntry } from "../plugins/clawforce-compliance/index.js";

export interface StorageConfig {
  dbPath: string;
  complianceLogPath: string;
  routingLogPath: string;
}

/** Raw SQL row type for compliance_events table. */
export interface ComplianceEventRow {
  id: number;
  ts: string;
  event: string;
  agent_id: string | null;
  channel: string | null;
  data: string;
  created_at: string;
}

/** Typed input for routing log entries (matches what router plugin writes). */
export interface RoutingLogEntry {
  ts: string;
  event: string;
  agentId?: string;
  sessionKey?: string;
  model?: string;
  reason?: string;
  hasPII?: boolean;
  piiTypes?: string[];
  complexity?: string;
  domain?: string;
  domainConfidence?: number;
  dimension?: string;
  matchedCondition?: string;
  dataTier?: string;
  budgetSpent?: number;
  budgetRemaining?: number;
  // Output redaction fields
  redactedTypes?: string[];
  matchCount?: number;
  // Tool result redaction fields
  toolName?: unknown;
  // Session end fields
  success?: unknown;
  durationMs?: unknown;
  messageCount?: number;
}

export interface RoutingDecisionRow {
  id: number;
  ts: string;
  agent_id: string | null;
  selected_model: string;
  selected_provider: string | null;
  has_pii: number;
  pii_types: string | null;
  complexity: string | null;
  domain: string | null;
  data_tier: string | null;
  is_local: number;
  estimated_cost: number;
  data: string;
  created_at: string;
}

export interface UsageMetricRow {
  id: number;
  ts: string;
  agent_id: string | null;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  is_local: number;
  created_at: string;
}

export interface BudgetStateRow {
  agent_id: string;
  date: string;
  spent: number;
  request_count: number;
  updated_at: string;
}

export interface AlertRow {
  id: number;
  ts: string;
  severity: string;
  type: string;
  agent_id: string | null;
  message: string;
  acknowledged: number;
  data: string | null;
  created_at: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalCost: number;
  localRequests: number;
  cloudRequests: number;
  modelBreakdown: Record<string, { count: number; cost: number }>;
}

export interface ModelDistribution {
  model: string;
  count: number;
  percentage: number;
}

export interface DailySpend {
  date: string;
  spent: number;
  requestCount: number;
}

export { ComplianceEntry };
```

**Test file**: `test/unit/storage/types.test.ts` — Import verification, type compatibility checks.

#### Unit 1B: Database Module (`src/storage/database.ts`)

**New file**: `src/storage/database.ts`

```typescript
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

const DEFAULT_DB_PATH = "/home/node/.openclaw/data/clawforce.db";

let db: DatabaseSync | null = null;

export function getDatabase(dbPath?: string): DatabaseSync {
  if (!db) {
    const path = dbPath ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA busy_timeout=5000");  // 5s retry on SQLITE_BUSY (multi-process safety)
    runMigrations(db);
  }
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

/** Create an in-memory database for testing. Runs migrations automatically. */
export function createTestDatabase(): DatabaseSync {
  const testDb = new DatabaseSync(":memory:");
  testDb.exec("PRAGMA foreign_keys=ON");
  runMigrations(testDb);
  return testDb;
}
```

**Test file**: `test/unit/storage/database.test.ts`
- Schema creates correctly in `:memory:` database
- All tables exist after initialization
- All indexes exist after initialization
- WAL mode is set (real file test with tmpdir)
- `busy_timeout` pragma is set to 5000
- `closeDatabase()` cleans up singleton
- `createTestDatabase()` returns a fresh in-memory DB with schema

#### Unit 1C: Migrations Module (`src/storage/migrations.ts`)

**New file**: `src/storage/migrations.ts`

```typescript
import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema — compliance, routing, usage, budget, alerts",
    up: (db) => {
      db.exec(`...full schema SQL from above...`);
    },
  },
];

export function runMigrations(db: DatabaseSync): void {
  // Create schema_version table if not exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const currentVersion = getCurrentVersion(db);

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.exec("BEGIN");
      try {
        migration.up(db);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  }
}

function getCurrentVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

export function getMigrations(): Migration[] {
  return [...migrations];
}
```

**Test file**: `test/unit/storage/migrations.test.ts`
- Version tracking works (starts at 0, increments)
- Migrations are idempotent (running twice doesn't error)
- Failed migration rolls back (no partial schema)
- `getCurrentVersion()` returns correct value
- All migrations apply cleanly to fresh `:memory:` DB

#### Unit 1D: Re-export Index (`src/storage/index.ts`)

**New file**: `src/storage/index.ts` — Re-exports from `database.ts`, `writer.ts`, `reader.ts`, `types.ts`.

**Commit 1**: `feat(storage): add database module with schema migrations and types`
**Push** after commit.

---

### Phase 2: StorageWriter (Dual-Write)

**Goal**: Create the `StorageWriter` class that dual-writes to JSONL + SQLite.

#### Unit 2A: StorageWriter (`src/storage/writer.ts`)

**New file**: `src/storage/writer.ts`

The writer wraps existing JSONL append logic and adds SQLite inserts. Key behaviors:
- JSONL write always happens first (source of truth)
- SQLite insert is best-effort — if it fails, JSONL still succeeds
- **Prepared statements cached in constructor** (not recompiled per call — review finding #7A)
- Accepts injected `DatabaseSync` for testability (`:memory:` in tests)
- **Type-safe**: uses `RoutingLogEntry` instead of `Record<string, unknown>` (review finding #8A)
- **Safe type narrowing**: uses `typeof x === 'string'` checks instead of unsafe casts (review finding #8B)

```typescript
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ComplianceEntry } from "../plugins/clawforce-compliance/index.js";
import type { RoutingLogEntry } from "./types.js";
import { isLocalModel } from "../shared/pricing.js";

export class StorageWriter {
  private db: DatabaseSync;
  private complianceLogPath: string;
  private routingLogPath: string;
  private dirCache = new Set<string>();

  // Cached prepared statements (compiled once in constructor, reused per call)
  private stmtCompliance: StatementSync;
  private stmtRouting: StatementSync;
  private stmtBudget: StatementSync;

  constructor(db: DatabaseSync, complianceLogPath: string, routingLogPath: string) {
    this.db = db;
    this.complianceLogPath = complianceLogPath;
    this.routingLogPath = routingLogPath;

    // Pre-compile statements for performance (hot path: every hook invocation)
    this.stmtCompliance = db.prepare(
      `INSERT INTO compliance_events (ts, event, agent_id, channel, data) VALUES (?, ?, ?, ?, ?)`
    );
    this.stmtRouting = db.prepare(
      `INSERT INTO routing_decisions (ts, agent_id, selected_model, selected_provider, has_pii, pii_types, complexity, domain, data_tier, is_local, estimated_cost, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtBudget = db.prepare(
      `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, date) DO UPDATE SET
         spent = excluded.spent,
         request_count = excluded.request_count,
         updated_at = datetime('now')`
    );
  }

  writeComplianceEvent(entry: ComplianceEntry): void {
    // 1. JSONL (source of truth)
    this.appendJsonl(this.complianceLogPath, entry);
    // 2. SQLite (best-effort query layer)
    try {
      this.stmtCompliance.run(
        entry.ts,
        entry.event,
        typeof entry.agentId === "string" ? entry.agentId : null,
        typeof entry.channel === "string" ? entry.channel : null,
        JSON.stringify(entry),
      );
    } catch (err) {
      process.stderr.write(`[storage] SQLite compliance insert failed: ${String(err)}\n`);
    }
  }

  writeRoutingDecision(entry: RoutingLogEntry): void {
    // 1. JSONL
    this.appendJsonl(this.routingLogPath, entry);
    // 2. SQLite
    try {
      const model = entry.model ?? "";
      const provider = model.includes("/") ? model.split("/")[0] : null;
      this.stmtRouting.run(
        entry.ts,
        entry.agentId ?? null,
        model,
        provider,
        entry.hasPII ? 1 : 0,
        entry.piiTypes ? JSON.stringify(entry.piiTypes) : null,
        entry.complexity ?? null,
        entry.domain ?? null,
        entry.dataTier ?? null,
        isLocalModel(model) ? 1 : 0,
        0, // estimated_cost populated later
        JSON.stringify(entry),
      );
    } catch (err) {
      process.stderr.write(`[storage] SQLite routing insert failed: ${String(err)}\n`);
    }
  }

  writeBudgetState(agentId: string, date: string, spent: number, requestCount: number): void {
    try {
      this.stmtBudget.run(agentId, date, spent, requestCount);
    } catch (err) {
      process.stderr.write(`[storage] SQLite budget upsert failed: ${String(err)}\n`);
    }
  }

  private appendJsonl(logPath: string, entry: unknown): void {
    try {
      const dir = dirname(logPath);
      if (!this.dirCache.has(dir)) {
        mkdirSync(dir, { recursive: true });
        this.dirCache.add(dir);
      }
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      process.stderr.write(`[storage] JSONL write failed for ${logPath}: ${String(err)}\n`);
    }
  }
}
```

**Test file**: `test/unit/storage/writer.test.ts`
- `writeComplianceEvent()` inserts row into `compliance_events` table
- `writeComplianceEvent()` appends to JSONL file (mock `appendFileSync`)
- `writeComplianceEvent()` handles missing/undefined `agentId` and `channel` gracefully (null in DB)
- `writeRoutingDecision()` inserts row into `routing_decisions` table
- `writeRoutingDecision()` correctly extracts provider from model string
- `writeRoutingDecision()` sets `is_local=1` for local models
- `writeRoutingDecision()` handles entries with missing optional fields (null in DB, no crash)
- `writeBudgetState()` upserts into `budget_state` table
- SQLite failure does NOT prevent JSONL write (mock prepared statement `.run()` to throw)
- JSONL failure does NOT prevent SQLite write
- Directory creation is cached (only calls `mkdirSync` once per path)
- Prepared statements are reused across multiple calls (not recompiled)
- **Round-trip test**: write events, then read them back with `StorageReader` and verify data matches

**Commit 2**: `feat(storage): add StorageWriter with dual-write JSONL + SQLite`
**Push** after commit.

---

### Phase 3: StorageReader

**Goal**: Create the `StorageReader` class with typed query methods.

#### Unit 3A: StorageReader (`src/storage/reader.ts`)

**New file**: `src/storage/reader.ts`

```typescript
import type { DatabaseSync } from "node:sqlite";
import type {
  ComplianceEntry,
  RoutingDecisionRow,
  UsageSummary,
  BudgetStateRow,
  AlertRow,
  ModelDistribution,
  DailySpend,
} from "./types.js";

export class StorageReader {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getRecentEvents(opts: {
    limit: number;
    event?: string;
    agentId?: string;
  }): ComplianceEntry[] {
    // Build dynamic SQL with optional WHERE clauses
    // Parse `data` column back to ComplianceEntry
  }

  getRoutingDecisions(opts: {
    since?: string;
    agentId?: string;
    piiOnly?: boolean;
    limit?: number;
  }): RoutingDecisionRow[] { ... }

  getUsageSummary(opts: {
    days: number;
    agentId?: string;
  }): UsageSummary { ... }

  getBudgetState(agentId?: string): BudgetStateRow | null { ... }

  getAlerts(opts: {
    since?: string;
    severity?: string;
    unacknowledgedOnly?: boolean;
    limit?: number;
  }): AlertRow[] { ... }

  getModelDistribution(opts: {
    days: number;
    agentId?: string;
  }): ModelDistribution[] { ... }

  getDailySpend(opts: {
    days: number;
    agentId?: string;
  }): DailySpend[] { ... }

  getTotalEventCount(event?: string): number { ... }
}
```

**Test file**: `test/unit/storage/reader.test.ts`
- `getRecentEvents()` returns entries in descending order by ts
- `getRecentEvents()` filters by event type
- `getRecentEvents()` filters by agent ID
- `getRecentEvents()` respects limit
- `getRecentEvents()` returns empty array on empty DB
- `getRoutingDecisions()` filters by `since` timestamp
- `getRoutingDecisions()` filters `piiOnly` (has_pii=1)
- `getBudgetState()` returns null when no state exists
- `getBudgetState()` returns current day's state
- `getModelDistribution()` calculates percentages correctly
- `getDailySpend()` aggregates by date
- `getTotalEventCount()` returns correct count with/without event filter
- Edge case: `getRecentEvents()` with `limit: 0` returns empty array
- Edge case: `getRoutingDecisions()` with future `since` date returns empty array
- Edge case: `getModelDistribution()` with no data returns empty array (no division by zero)

**Commit 3**: `feat(storage): add StorageReader with typed query methods`
**Push** after commit.

---

### Phase 4: Wire Up Write Path (Modify Existing Plugins)

**Goal**: Integrate `StorageWriter` into the compliance and router plugins.

#### Unit 4A: Compliance Plugin Integration

**Modify**: `src/plugins/clawforce-compliance/index.ts`

Changes:
- Add optional `storageWriter` parameter to `activate()` via `pluginConfig`
- When `StorageWriter` is available, call `writer.writeComplianceEvent()` instead of `writeEntry()`
- Keep `writeEntry()` as fallback when no writer provided (backward compatibility)
- Export `writeEntry()` unchanged for any external callers

```typescript
// In activate():
const writer = api.pluginConfig?.storageWriter as StorageWriter | undefined;

// In each hook handler:
if (writer) {
  writer.writeComplianceEvent(entry);
} else {
  writeEntry(logPath, entry);
}
```

**Test updates**: `test/unit/plugins/clawforce-compliance/index.test.ts`
- Verify dual-write behavior when `storageWriter` is provided
- Verify fallback to `writeEntry()` when no writer
- Existing tests unchanged (they don't provide a writer)

#### Unit 4B: Router Plugin Integration

**Modify**: `src/plugins/clawforce-router/index.ts`

Changes:
- Add optional `storageWriter` parameter via `pluginConfig`
- When `StorageWriter` is available, call `writer.writeRoutingDecision()` instead of `writeRoutingLog()`
- Keep `writeRoutingLog()` as fallback
- Pass writer to output redaction and tool result redaction log writes too

```typescript
// In resolveConfig():
const writer = pluginConfig?.storageWriter as StorageWriter | undefined;

// In before_agent_start handler:
if (writer) {
  writer.writeRoutingDecision(routingEntry);
} else {
  writeRoutingLog(config.logPath, routingEntry);
}
```

**Test updates**: `test/unit/plugins/clawforce-router/index.test.ts`
- Verify routing decisions written to SQLite when writer provided
- Verify fallback to JSONL when no writer
- Existing 230+ tests unchanged

#### Unit 4C: Budget Tracker SQLite Backend

**Modify**: `src/plugins/clawforce-router/budget-tracker.ts`

Changes:
- Add optional `DatabaseSync` parameter to `BudgetTracker` constructor
- When DB available, use `budget_state` table instead of JSON file
- `loadState()` tries SQLite first, falls back to JSON file
- `saveState()` writes to both SQLite and JSON file (dual-write)
- `ensureCurrentDay()` uses SQL upsert

```typescript
export class BudgetTracker {
  private db: DatabaseSync | null;
  // ...existing fields...

  constructor(config: BudgetConfig, statePath?: string, db?: DatabaseSync) {
    this.db = db ?? null;
    // ...existing init...
  }

  private loadState(): BudgetState {
    if (this.db) {
      try {
        const row = this.db.prepare(
          "SELECT spent, request_count FROM budget_state WHERE agent_id = '_global' AND date = ?"
        ).get(todayString()) as { spent: number; request_count: number } | undefined;
        if (row) {
          return { date: todayString(), spent: row.spent, requestCount: row.request_count };
        }
      } catch { /* fall through to JSON */ }
    }
    // ...existing JSON file fallback...
  }

  private saveState(): void {
    // SQLite upsert (primary)
    if (this.db) {
      try {
        this.db.prepare(
          `INSERT INTO budget_state (agent_id, date, spent, request_count, updated_at)
           VALUES ('_global', ?, ?, ?, datetime('now'))
           ON CONFLICT(agent_id, date) DO UPDATE SET
             spent = excluded.spent, request_count = excluded.request_count, updated_at = datetime('now')`
        ).run(this.state.date, this.state.spent, this.state.requestCount);
      } catch { /* best-effort */ }
    }
    // JSON file fallback (always write for backward compat)
    // ...existing JSON writeFileSync...
  }
}
```

**Test updates**: `test/unit/plugins/clawforce-router/budget-tracker.test.ts`
- Verify budget state persists to SQLite when DB provided
- Verify SQLite load on construction
- Verify day rollover creates new row in SQLite
- Verify fallback to JSON when no DB
- Existing tests unchanged (they don't provide a DB)

**Commit 4**: `feat(storage): wire StorageWriter into compliance + router plugins`
**Push** after commit.

---

### Phase 5: Wire Up Read Path (Dashboard + CLI)

**Goal**: Switch dashboard and audit command from JSONL parsing to SQLite queries.

#### Unit 5A: Dashboard Activity Route

**Modify**: `clawforce-dashboard/src/app/api/activity/route.ts`

> **Critical: `node:sqlite` in Next.js** (review finding #5A)
> Next.js bundles API routes via webpack/turbopack, which cannot resolve `node:sqlite`.
> **Resolution**: Add `node:sqlite` to `serverExternalPackages` in `next.config.js`:
> ```js
> /** @type {import('next').NextConfig} */
> const nextConfig = { serverExternalPackages: ["node:sqlite"] };
> ```
> Also update dashboard `@types/node` from `^20` to `^22` for type support (review finding #5B).

**Modify**: `clawforce-dashboard/next.config.js` — Add `serverExternalPackages: ["node:sqlite"]`
**Modify**: `clawforce-dashboard/package.json` — Update `@types/node` to `^22`

Changes to `activity/route.ts`:
- Use a **cached module-level singleton** for the DB connection (not open/close per request — review finding #7B)
- Use `try/catch` around `new DatabaseSync()` instead of `existsSync` check (avoids TOCTOU race — review finding #7C)
- Inline the query logic (no cross-project import from `src/storage/` — review finding #5A)
- Fall back to existing JSONL parsing if no DB

```typescript
import { DatabaseSync } from "node:sqlite";

const DB_PATH = `${DATA_DIR}/clawforce.db`;

// Cached singleton — opened once, reused across requests
let cachedDb: DatabaseSync | null = null;

function getReadDb(): DatabaseSync | null {
  if (cachedDb) return cachedDb;
  try {
    cachedDb = new DatabaseSync(DB_PATH, { readOnly: true });
    return cachedDb;
  } catch {
    return null; // DB doesn't exist or can't be opened
  }
}

export async function GET(request: Request) {
  const db = getReadDb();
  if (db) {
    try {
      // Inline query — no cross-project StorageReader import
      const whereClause = eventFilter ? "WHERE event = ?" : "";
      const params = eventFilter ? [eventFilter] : [];
      const rows = db.prepare(
        `SELECT data FROM compliance_events ${whereClause} ORDER BY ts DESC LIMIT ?`
      ).all(...params, limit) as { data: string }[];
      const entries = rows.map((r) => JSON.parse(r.data));
      const countRow = db.prepare(
        `SELECT COUNT(*) as total FROM compliance_events ${whereClause}`
      ).get(...params) as { total: number };
      return NextResponse.json({ entries, total: countRow.total });
    } catch { /* fall through to JSONL */ }
  }
  // ...existing JSONL fallback...
}
```

**Note**: Dashboard queries are inlined rather than importing `StorageReader` from the main project. The dashboard is a separate Next.js build with its own `node_modules` and cannot import from `../src/storage/`. The inlined queries are simple SELECT statements that match `StorageReader`'s logic.

#### Unit 5B: Dashboard Log Parser Updates

**Modify**: `clawforce-dashboard/src/lib/log-parser.ts`

Changes:
- Keep all existing functions unchanged (backward compatibility)
- Add new SQLite-backed query functions that can replace them incrementally

#### Unit 5C: Audit Command SQLite Support

**Modify**: `src/commands/audit.ts`

Changes:
- Add new `AuditSource` option: `"database"`
- Add `--since`, `--event`, `--agent`, `--pii-only` flags
- When source is `"database"` (or auto-detected), use `StorageReader`
- Default: try database first, fall back to JSONL/container

```typescript
export type AuditSource = "container" | "compliance" | "database";

export async function auditCommand(
  tailLines: number,
  source: AuditSource = "container",
  opts?: { since?: string; event?: string; agent?: string; piiOnly?: boolean },
): Promise<void> {
  // If source is "database" or auto-detect DB exists
  if (source === "database") {
    readFromDatabase(deployDir, tailLines, opts);
    return;
  }
  // ...existing container/compliance logic...
}
```

> **Critical: CLI source parsing** (review finding #3C)
> The current `src/cli.ts` maps unknown `--source` values to `"container"` by default.
> Must update the CLI to accept `"database"` as a valid source option:
> ```typescript
> // In cli.ts, update the audit command source option:
> .addOption(new Option("--source <source>", "Log source")
>   .choices(["container", "compliance", "database"])
>   .default("container"))
> ```

**Modify**: `src/cli.ts`
- Add `"database"` to valid `--source` choices for audit command
- Add `--since`, `--event`, `--agent`, `--pii-only` options to audit command
- Pass options through to `auditCommand()`

**Test updates**: `test/unit/commands/audit.test.ts`
- Verify `--source database` is accepted and routes to SQLite reader
- Verify `--since` filtering works via SQLite
- Verify `--event` filtering
- Verify `--pii-only` flag
- Verify fallback to JSONL when DB doesn't exist

**Commit 5**: `feat(storage): switch dashboard + audit to SQLite read path`
**Push** after commit.

---

### Phase 6: Migration Command

**Goal**: `clawforce migrate` command to backfill existing JSONL data into SQLite.

#### Unit 6A: Migrate Command (`src/commands/migrate.ts`)

**New file**: `src/commands/migrate.ts`

```typescript
export async function migrateCommand(opts: {
  dataDir: string;
  dryRun?: boolean;
}): Promise<void> {
  // 1. Open/create SQLite DB at dataDir/clawforce.db
  // 2. Read compliance.jsonl, parse each line
  // 3. Batch-insert into compliance_events (1000 rows per transaction)
  // 4. Read routing.jsonl, parse each line
  // 5. Batch-insert into routing_decisions
  // 6. Read budget-state.json, upsert into budget_state
  // 7. Report counts (inserted, skipped, errors)
  //
  // Idempotency strategy (review finding #6A):
  // - Use a content hash (SHA-256 of the full JSONL line) stored in a
  //   `migration_hashes` temp table during migration
  // - Before inserting, check if the hash already exists in the target table's
  //   `data` column (hash of `data` TEXT)
  // - This avoids the flawed ts+event approach since multiple events can share
  //   the same timestamp
  // - Alternative simpler approach: track "last migrated byte offset" per file
  //   in a `migration_state` table, so reruns skip already-processed bytes
}
```

> **Migration idempotency** (review finding #6A): The original plan used `ts+event` for dedup,
> but multiple events can share the same millisecond timestamp. Instead, use a byte-offset
> watermark approach: track the last successfully migrated byte position per file in a
> `migration_state` table. On rerun, `seek()` to that offset and continue. This is simpler
> and more reliable than content hashing.
>
> ```sql
> CREATE TABLE IF NOT EXISTS migration_state (
>   source_file TEXT PRIMARY KEY,
>   byte_offset INTEGER NOT NULL DEFAULT 0,
>   last_migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
> );
> ```

**Test file**: `test/unit/commands/migrate.test.ts`
- Migrates sample compliance.jsonl entries
- Migrates sample routing.jsonl entries
- Migrates budget-state.json
- Idempotent: running twice doesn't duplicate (byte-offset watermark)
- Interrupted migration resumes from last byte offset
- `--dry-run` reports counts without inserting
- Handles empty/missing files gracefully
- Batch insert with >1000 entries verifies transaction batching

#### Unit 6B: Wire into CLI

**Modify**: `src/cli.ts`

Add `clawforce migrate` subcommand with `--data-dir` and `--dry-run` flags.

**Commit 6**: `feat(storage): add clawforce migrate command for JSONL backfill`
**Push** after commit.

---

### Phase 7: Code Review + Fix

**Goal**: Sub-agent reviews all changes for quality, coverage, regressions.

- Dispatch code review sub-agent
- Review all modified and new files
- Check for: type safety, error handling, test coverage, interface contracts
- Fix any issues found
- Run full test suite
- Commit fixes separately

**Commit 7**: `fix(storage): address code review findings`
**Push** after commit.

---

### Phase 8: Smoke Test

**Goal**: Validate the feature works end-to-end in real conditions.

1. **Initialize**: Create a temp directory with sample `compliance.jsonl` and `routing.jsonl` files
2. **Test dual-write**: Run plugin hooks and verify both JSONL and SQLite contain the data
3. **Test reader**: Query SQLite and verify results match JSONL content
4. **Test migration**: Run `clawforce migrate` on existing JSONL files, verify data in SQLite
5. **Test audit**: Run `clawforce audit --source database --since 2026-02-15` and verify output
6. **Test budget**: Create `BudgetTracker` with SQLite, record spend, restart, verify state persists
7. **Re-run full test suite** after any fixes

**Commit 8**: `test(storage): add smoke test fixes and additional coverage`
**Push** after commit.

---

### Phase 9: Documentation

**Goal**: Update README and docs with SQLite storage layer info.

- Update `README.md` with storage architecture info
- Update `ROADMAP.md` to mark 2A.1 as complete
- Document `clawforce migrate` in CLI docs
- Document new `--since`, `--event`, `--agent` audit flags

**Commit 9**: `docs: document SQLite storage layer and migrate command`
**Push** after commit.

---

### Phase 10: Open PR

- `gh pr ready` to switch draft → open
- Final PR description with summary of all changes

---

## File Inventory

### New Files (8)
```
src/storage/
  ├── index.ts            # Re-exports
  ├── database.ts         # SQLite connection + initialization
  ├── migrations.ts       # Versioned schema migrations
  ├── writer.ts           # Dual-write (JSONL + SQLite)
  ├── reader.ts           # Typed query methods
  └── types.ts            # Shared storage types

src/commands/migrate.ts   # JSONL -> SQLite backfill command
```

### Modified Files (9)
```
src/plugins/clawforce-compliance/index.ts  # Use StorageWriter when available
src/plugins/clawforce-router/index.ts      # Use StorageWriter when available
src/plugins/clawforce-router/budget-tracker.ts  # SQLite-backed state
clawforce-dashboard/src/app/api/activity/route.ts  # Query SQLite (fallback JSONL)
clawforce-dashboard/src/lib/log-parser.ts  # Add SQLite query functions
clawforce-dashboard/next.config.js         # Add serverExternalPackages for node:sqlite
clawforce-dashboard/package.json           # Update @types/node to ^22
src/commands/audit.ts     # Add --source database + filter flags
src/cli.ts                # Add migrate subcommand + audit source/filter options
```

### New Test Files (5)
```
test/unit/storage/types.test.ts
test/unit/storage/database.test.ts
test/unit/storage/writer.test.ts
test/unit/storage/reader.test.ts
test/unit/storage/migrations.test.ts
test/unit/commands/migrate.test.ts
```

### Modified Test Files (3)
```
test/unit/plugins/clawforce-compliance/index.test.ts  # Dual-write behavior
test/unit/plugins/clawforce-router/budget-tracker.test.ts  # SQLite backend
test/unit/commands/audit.test.ts  # SQLite query flags
```

---

## Review Findings Incorporated

The following issues were identified during plan review and addressed above:

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 5A | **Must Fix** | `node:sqlite` can't be bundled by Next.js webpack | Add `serverExternalPackages` to `next.config.js` |
| 5B | **Must Fix** | Dashboard `@types/node` is `^20`, needs `^22` | Update dashboard `package.json` |
| 3C | **Must Fix** | CLI source parsing ignores `"database"` value | Add `"database"` to valid choices in `cli.ts` |
| 7A | **Must Fix** | Prepared statements recompiled on every write | Cache `StatementSync` objects in constructor |
| 8A | **Should Fix** | `writeRoutingDecision` typed as `Record<string, unknown>` | Created `RoutingLogEntry` interface |
| 8B | **Should Fix** | Unsafe `as string` casts on entry fields | Changed to `typeof x === 'string'` checks |
| 8D | **Should Fix** | Missing `ComplianceEventRow` type | Added to `types.ts` |
| 2A | **Should Fix** | No `busy_timeout` for multi-process safety | Added `PRAGMA busy_timeout=5000` |
| 6A | **Should Fix** | Migration idempotency via `ts+event` is flawed | Changed to byte-offset watermark strategy |
| 7B | **Should Fix** | Dashboard opens/closes DB per request | Changed to cached module-level singleton |
| 7C | **Should Fix** | `existsSync` + open is TOCTOU race | Changed to `try/catch` around `DatabaseSync()` |
| 4F | **Test Gap** | No round-trip writer/reader test | Added to writer test list |
| 4B | **Test Gap** | No test for null/undefined fields on NOT NULL columns | Added to writer test list |
| 4D | **Test Gap** | No test for batch migration (>1000 entries) | Added to migrate test list |
| 4E | **Test Gap** | Missing reader edge cases (limit:0, future dates, empty data) | Added to reader test list |

### Deferred (acceptable for Phase 2A.1)
- **ComplianceEntry re-export coupling** (#8C): `types.ts` imports from compliance plugin. Acceptable for now; can decouple in a future refactor by moving the interface to types.ts and having the plugin import from there.
- **Docker filesystem requirements** (#2B): WAL mode needs local filesystem. Documented in risks table below.
- **Large `data` column size** (#2D): No truncation for now. Compliance entries are small (<1KB). Monitor in production.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `node:sqlite` API differences across Node versions | Low | Pin to Node 22+ (same as OpenClaw). Test in CI. |
| SQLite WAL file corruption on unclean shutdown | Very Low | WAL mode + journal. JSONL is source of truth for recovery. |
| Dashboard can't import from `src/storage/` (separate Next.js project) | Medium | Dashboard reads DB file directly via `node:sqlite` with inline reader. No cross-project imports needed. |
| Large JSONL backfill takes too long | Low | Batched inserts (1000 rows per transaction). Progress reporting. |
| Breaking existing tests that mock file I/O | Medium | StorageWriter accepts injected DB (`:memory:` in tests). All existing tests run without writer (fallback path). |
| Docker volume mount breaks WAL mode | Low | WAL requires local filesystem (not NFS/network). Document that data dir must be a local volume mount. Default Docker Compose config already uses local volume. |

---

## Success Criteria

### Automated Verification
- [ ] `test/unit/storage/database.test.ts` — Schema creates correctly, migrations run idempotently
- [ ] `test/unit/storage/writer.test.ts` — Dual-write works, SQLite failure doesn't break JSONL
- [ ] `test/unit/storage/reader.test.ts` — All query methods return correct results with filters
- [ ] `test/unit/storage/migrations.test.ts` — Version tracking, idempotent application
- [ ] `test/unit/commands/migrate.test.ts` — Backfill works, idempotent, handles edge cases
- [ ] Existing 590+ tests still pass (no regressions)
- [ ] 80% coverage threshold maintained
- [ ] Pre-commit hooks pass on every commit (format, lint, typecheck, knip, tests)

### Manual Verification
- [ ] Dashboard `/api/activity` returns same data from SQLite as it did from JSONL
- [ ] `clawforce audit --source database --since 2026-02-15` returns filtered results
- [ ] Budget tracker state survives process restart (SQLite persistence)
- [ ] JSONL files still written alongside SQLite (dual-write verified)
- [ ] `clawforce migrate` successfully imports sample JSONL files into SQLite

---

## Task Checklist (for TaskCreate)

```
Task 1: Research & Analysis ✅ (this plan)
Task 2: Create Implementation Plan ✅ (this document)
Task 3: Plan Review (Sub-agent) — review this plan
Task 4: Create Feature Branch + Draft PR
Task 5: Phase 1 — Storage types + database module + migrations
Task 6: Phase 2 — StorageWriter (dual-write)
Task 7: Phase 3 — StorageReader (typed queries)
Task 8: Phase 4 — Wire write path (compliance + router + budget)
Task 9: Phase 5 — Wire read path (dashboard + audit)
Task 10: Phase 6 — Migration command
Task 11: Code Review (Sub-agent)
Task 12: Smoke Test
Task 13: Update Documentation
Task 14: Open PR
```
