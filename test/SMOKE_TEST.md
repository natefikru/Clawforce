# Clawforce Smoke Test Checklist

Run this checklist after each build to validate the deployment works end-to-end.

## Prerequisites

- [ ] Docker Desktop running
- [ ] Valid Slack bot tokens in environment
- [ ] Anthropic API key set (`export ANTHROPIC_API_KEY="sk-ant-..."`)
- [ ] If using cloud model + `credential_mode: env`, ensure `models.api_key` is configured

## Test Steps

### 1. Deploy

```bash
clawforce deploy --config ./clawforce.yaml
```

**Expected**:
- [ ] No errors during deployment
- [ ] Gateway health check passes within 30s
- [ ] Directory `clawforce-<name>/` created with full structure
- [ ] Security audit gate runs and reports no critical findings
- [ ] If bypass used (`CLAWFORCE_SKIP_SECURITY_AUDIT=1`), it is local-only and explicitly documented

### 2. Verify Directory Structure

```bash
ls -la clawforce-<name>/
```

**Expected**:
- [ ] `docker-compose.yml` exists
- [ ] `config/openclaw.json` exists
- [ ] `workspace/AGENTS.md` exists
- [ ] `workspace/skills/<role>/SKILL.md` exists
- [ ] `data/audit.jsonl` exists
- [ ] `.env` exists (with restricted permissions)

### 3. Verify Containers

```bash
docker ps | grep clawforce
```

**Expected**:
- [ ] `clawforce-<name>-gateway` running
- [ ] `clawforce-<name>-ollama` running (if enabled)

### 4. Health Check

```bash
curl http://127.0.0.1:18789/health
```

**Expected**:
- [ ] Returns HTTP 200

### 5. Check Status

```bash
clawforce status
```

**Expected**:
- [ ] Shows running containers with status

### 6. Slack Integration

- [ ] Bot appears online in Slack workspace
- [ ] Send message in monitored channel mentioning bot
- [ ] Bot responds appropriately
- [ ] Check approval channel for approval requests (if hybrid mode)
- [ ] React with checkmark to approve
- [ ] React with X to reject

### 7. Cron Job (Inbox Analyst only)

- [ ] Wait for scheduled cron time (or check cron job list)
- [ ] Daily briefing delivered to channel

### 8. Audit Log

```bash
clawforce audit --tail 10
```

**Expected**:
- [ ] Shows recent agent actions in JSONL format
- [ ] Entries have timestamp, agent, action, result fields

### 9. Security Audit Gate Semantics

- [ ] Deploy blocks if audit reports critical findings
- [ ] Local bypass behavior is explicit:
  - [ ] `CLAWFORCE_SKIP_SECURITY_AUDIT=1` allows local smoke iteration
  - [ ] Bypass is not used in shared/staging/prod environments

### 10. Per-Agent Query Spot Check

```bash
clawforce audit --source database --agent _global --tail 5
```

**Expected**:
- [ ] Database query path resolves correctly when data exists
- [ ] Agent filter is accepted and produces isolated output

### 11. Stop Deployment

```bash
clawforce stop
```

**Expected**:
- [ ] All clawforce containers stopped
- [ ] `docker ps | grep clawforce` returns nothing

## Cleanup

```bash
rm -rf clawforce-<name>/
```
