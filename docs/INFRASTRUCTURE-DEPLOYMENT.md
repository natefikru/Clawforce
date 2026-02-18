# Clawforce: Infrastructure & Deployment Guide

**Date**: 2026-02-16
**Status**: Internal reference — pre-Phase 2B

---

## Architecture Overview

A Clawforce deployment has two main components:

```
┌─────────────────────────────────────────┐
│  Gateway Layer (OpenClaw + Clawforce)   │  ← CPU-only, lightweight
│  - Message routing & channel bindings   │
│  - Clawforce router plugin              │
│  - Compliance plugin                    │
│  - PII detection & policy enforcement   │
│  - Storage (JSONL + SQLite)             │
│  - Dashboard (SSE + REST API)           │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────┐
│ Cloud LLMs  │  │ Local LLMs  │  ← GPU required for local
│ (API keys)  │  │ (Ollama,    │
│ Anthropic   │  │  SGLang,    │
│ OpenAI      │  │  vLLM)      │
│ Google      │  │             │
└─────────────┘  └─────────────┘
```

**Key insight**: The gateway and local model inference can (and often should) run on separate machines. The gateway is CPU-bound and lightweight. Local model inference is GPU-bound and resource-intensive.

NOTE: Some sections in this document describe target-state infrastructure (Phase 2C+ / 3+). Where behavior is not first-class in current `clawforce.yaml`, this guide now calls out manual workarounds explicitly.

---

## Deployment Options

### Option 1: Cloud-Only (No Local Models)

All inference goes to cloud providers (Anthropic, OpenAI, Google). No GPU needed.

**Infrastructure Requirements:**
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPUs |
| RAM | 2 GB | 4 GB |
| Storage | 10 GB SSD | 20 GB SSD |
| GPU | None | None |
| Network | Standard | Standard |

**Monthly Cost Breakdown:**

| Component | Low | Mid | High |
|-----------|-----|-----|------|
| VPS hosting | $5 | $15 | $50 |
| Cloud API tokens (1 agent, light use) | $20 | $50 | $80 |
| Cloud API tokens (3 agents, moderate) | $60 | $150 | $300 |
| Cloud API tokens (10 agents, heavy) | $200 | $500 | $1,000+ |
| **Total (1 agent)** | **$25** | **$65** | **$130** |
| **Total (3 agents)** | **$65** | **$165** | **$350** |
| **Total (10 agents)** | **$205** | **$515** | **$1,050+** |

**Real-world data points:**
- Typical single-agent deployments report $20-80/mo in API costs
- One power user running high-volume workflows reported $3,600/mo in API costs alone (180M tokens/mo)
- API costs scale linearly with token volume — the Clawforce router's model-switching capability can reduce this by 40-65% by routing simple tasks to cheaper models

**Suitable hosting providers:**
- DigitalOcean Droplet ($6-24/mo)
- Hetzner Cloud ($4-15/mo)
- AWS Lightsail ($5-40/mo)
- Oracle Cloud Free Tier (4 ARM CPUs, 24GB RAM — free forever)
- Railway / Render ($5-25/mo)

**Best for:** Getting started fast, variable workloads, teams that want zero GPU management overhead.

---

### Option 2: Single Machine with GPU (Local + Cloud Models)

Gateway and local model inference on the same machine. Best cost-performance for small-to-medium deployments.

**Infrastructure Requirements:**
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 16 GB | 32 GB |
| Storage | 50 GB SSD | 100 GB NVMe |
| GPU VRAM | 16 GB | 24-48 GB |
| Network | Standard | Low-latency |

**GPU VRAM Requirements by Model Size:**

| Model | Parameters | VRAM (Q4 quantized) | VRAM (FP16) | Example Models |
|-------|-----------|---------------------|-------------|----------------|
| Small | 7-8B | 4-6 GB | 14-16 GB | Llama 3.3 8B, Mistral 7B |
| Medium | 13-14B | 8-10 GB | 26-28 GB | Llama 2 13B, CodeLlama 13B |
| Large | 32-34B | 18-20 GB | 64-68 GB | Qwen 3 32B, CodeLlama 34B |
| XL | 70B | 35-40 GB | 140+ GB | Llama 3 70B (needs multi-GPU) |

**Rule of thumb:** Model parameters × 0.5-1 GB for Q4 quantization, × 2 GB for FP16.

**Monthly Cost — Cloud GPU Instances:**

| Provider | GPU | VRAM | Monthly Cost |
|----------|-----|------|-------------|
| Lambda Labs | RTX A6000 | 48 GB | ~$400/mo |
| Vast.ai | RTX 4090 | 24 GB | $200-350/mo |
| Vast.ai | RTX A6000 | 48 GB | $350-600/mo |
| RunPod | RTX A6000 | 48 GB | $400-600/mo |
| AWS (g5.xlarge) | A10G | 24 GB | ~$750/mo |
| GCP (a2-highgpu-1g) | A100 | 40 GB | ~$900/mo |

**Monthly Cost — Self-Hosted GPU (amortized):**

| GPU | Purchase Price | Amortized Monthly (3yr) | Power Cost |
|-----|---------------|------------------------|------------|
| RTX 4090 | $1,600-2,000 | ~$50/mo | $15-25/mo |
| RTX A6000 | $3,500-4,500 | ~$110/mo | $20-30/mo |
| RTX 4090 × 2 | $3,200-4,000 | ~$100/mo | $30-50/mo |

**Total monthly (cloud GPU + API fallback):**
- Vast.ai RTX 4090 + light cloud API: **$250-400/mo**
- Lambda A6000 + moderate cloud API: **$500-700/mo**
- Self-hosted RTX 4090 + light cloud API: **$100-150/mo** (after hardware purchase)

**Best for:** Teams committed to cost optimization, privacy-sensitive deployments, predictable workloads.

---

### Option 2B: Mac mini-First (Host Runtime + Docker Gateway)

Run OpenClaw + Clawforce in Docker, but run local inference natively on macOS (for example, Ollama with Apple Silicon acceleration).

```yaml
local_model:
  engine: "ollama"
  location: "host"
  host_url: "http://host.docker.internal:11434"
  model: "llama3.3:8b"
```

**How this works:**
1. `local_model.location: host` tells Clawforce not to launch an inference sidecar container.
2. The gateway routes local-model traffic to `local_model.host_url`.
3. Router/compliance/PII invariants remain unchanged.

**Best for:** Home-lab and small-team deployments that want local privacy and lower recurring cloud spend without managing Linux GPU servers.

---

### Option 3: Split Architecture (Recommended for Production)

Gateway on a cheap VPS, local models on a dedicated GPU server. Most flexible and cost-effective for multi-agent deployments.

```
┌─────────────────┐         ┌─────────────────────┐
│  Gateway VPS    │  HTTP   │  GPU Inference       │
│  ($10-30/mo)    │ ◄─────► │  Server              │
│                 │         │  ($200-600/mo cloud)  │
│  - OpenClaw     │         │  - Ollama / vLLM     │
│  - Clawforce    │         │  - Model weights     │
│  - Dashboard    │         │  - Inference API     │
│  - Storage      │         │                      │
└─────────────────┘         └──────────────────────┘
```

**Gateway VPS Requirements (same as Cloud-Only):**
| Resource | Recommended |
|----------|-------------|
| CPU | 2 vCPUs |
| RAM | 4 GB + 8 GB per concurrent agent |
| Storage | 20 GB SSD |
| Cost | $10-30/mo |

**Per-Agent RAM:** Community reports suggest ~8 GB RAM per concurrent agent for smooth multi-agent operation. A 3-agent deployment should have 24-32 GB RAM available on the gateway.

**GPU Server Requirements:**
| Resource | Recommended |
|----------|-------------|
| GPU | 24-48 GB VRAM |
| CPU | 4+ cores |
| RAM | 16+ GB |
| Storage | 100 GB NVMe (for model weights) |
| Cost | $200-600/mo (cloud) |

**Why split?**
1. **Scale independently** — add more GPU servers without touching the gateway
2. **Cost optimize** — gateway runs 24/7 cheap, GPU server can be spot/preemptible for 60-80% savings
3. **Maintenance** — update models without gateway downtime
4. **Multi-agent ready** — You can scale GPU inference independently and place a load balancer in front of inference nodes
5. **Hybrid routing** — PII-sensitive requests go to local GPU, everything else to cloud APIs

**Connection:** Configure remote inference directly in `clawforce.yaml`:
```yaml
local_model:
  engine: "ollama" # or sglang / vllm
  location: "host"
  host_url: "http://gpu-lb.internal:11434"
```

**Best for:** Production deployments, multi-agent orchestration (Phase 2B+), regulated industries.

---

### Option 4: Kubernetes / Container Orchestration

For large-scale enterprise deployments with multiple customer tenants.

```yaml
# Conceptual — not production config
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clawforce-gateway
spec:
  replicas: 2  # HA gateway
  template:
    spec:
      containers:
        - name: openclaw-gateway
          image: openclaw/gateway:latest
          resources:
            requests:
              cpu: "1"
              memory: "4Gi"
        - name: clawforce-dashboard
          image: clawforce/dashboard:latest
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inference-pool
spec:
  replicas: 3  # GPU inference workers
  template:
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          resources:
            limits:
              nvidia.com/gpu: 1
      nodeSelector:
        gpu: "true"
```

**Monthly Cost (managed Kubernetes + GPU nodes):**
- Control plane: $70-150/mo (EKS/GKE/AKS)
- Gateway nodes (2x): $40-80/mo
- GPU nodes (spot/preemptible): $300-800/mo
- **Total: $400-1,000+/mo**

**Best for:** Multi-tenant SaaS offerings, enterprise customers requiring HA/DR, teams with existing Kubernetes expertise.

---

## Cost Comparison Summary

| Deployment | Monthly Cost | Local Models | Multi-Agent Ready | Complexity |
|-----------|-------------|-------------|-------------------|------------|
| Cloud-only (1 agent) | $25-130 | No | Limited | Low |
| Cloud-only (3 agents) | $65-350 | No | Yes | Low |
| Single GPU machine | $250-700 | Yes | Yes | Medium |
| Split architecture | $210-630 | Yes | Yes | Medium |
| Self-hosted GPU + VPS | $100-180 | Yes | Yes | Medium-High |
| Kubernetes | $400-1,000+ | Yes | Yes | High |

---

## Cost Optimization Strategies

### 1. Clawforce Router (Built-in)

The 5-dimension router is the primary cost optimization tool:

- **Complexity routing**: Simple queries → cheap models (Haiku, GPT-4o-mini), complex → capable models (Sonnet, GPT-4o)
- **Local-first routing**: Non-PII, non-complex tasks → local models (zero API cost)
- **Budget caps**: Daily/monthly spending limits per agent prevent runaway costs
- **Model health failover**: If local model is down, gracefully fall back to cloud (not the other way — PII never goes to cloud)

**Reported savings:** 40-65% reduction in cloud API costs when combining local and cloud models with intelligent routing.

### 2. Spot/Preemptible GPU Instances

Cloud GPU costs drop 60-80% with spot pricing:
- AWS Spot g5.xlarge: ~$250/mo (vs ~$750 on-demand)
- GCP Preemptible a2-highgpu: ~$300/mo (vs ~$900 on-demand)

**Trade-off:** Instances can be reclaimed with 30s-2min notice. The gateway can keep running, and non-PII traffic can fail over to cloud only when `failover_policy=failover-safe` with a cloud default model. PII traffic remains fail-closed by design.

### 3. Model Quantization

Running Q4-quantized models instead of FP16:
- **Half the VRAM** = half the GPU cost (or run larger models on same hardware)
- **Minimal quality loss** for most tasks (1-3% on benchmarks)
- Ollama handles quantization automatically via model tags (e.g., `llama3.3:8b-q4_K_M`)

### 4. Scheduled GPU Scaling

If workloads are predictable (business hours only):
- Run GPU inference server only during business hours (12h/day = 50% savings)
- After-hours traffic routes to cloud models via Clawforce's automatic failover
- Cron job or cloud scheduler to start/stop GPU instances

---

## Phase 2B Multi-Agent Infrastructure Considerations

Phase 2B (Multi-Agent Orchestration) introduces the "Ultron" supervisory pattern where multiple agents coordinate on tasks. Infrastructure implications:

### RAM Scaling
- Each concurrent agent needs ~8 GB RAM on the gateway
- 3-agent deployment: 32 GB RAM recommended
- 10-agent deployment: 96+ GB RAM recommended
- The gateway VPS must scale with agent count

### Inference Load
- Multiple agents making simultaneous requests to local models
- vLLM handles concurrent requests better than Ollama for multi-agent (built-in batching)
- Consider SGLang for highest throughput multi-agent scenarios
- May need multiple GPU instances behind an external load balancer (current code does not do endpoint fan-out internally)

### Recommended Phase 2B Infrastructure

**Minimum viable (3 agents):**
- Gateway: 4 vCPU, 32 GB RAM, $30-60/mo
- GPU: RTX 4090 (24 GB VRAM), $200-350/mo (cloud) or self-hosted
- Cloud API budget: $100-300/mo
- **Total: $330-710/mo**

**Production (10 agents):**
- Gateway: 8 vCPU, 96 GB RAM, $100-200/mo
- GPU: 2× RTX A6000 or 1× A100 (48-80 GB VRAM), $400-900/mo
- Cloud API budget: $300-1,000/mo
- **Total: $800-2,100/mo**

---

## Infrastructure Templates (Future: Phase 2C+)

Clawforce will generate deployment manifests from `clawforce.yaml`:

```yaml
# clawforce.yaml infrastructure section (planned)
infrastructure:
  mode: split  # single | split | kubernetes
  gateway:
    provider: digitalocean
    size: s-2vcpu-4gb
    region: nyc1
  inference:
    provider: vast.ai
    gpu: rtx4090
    spot: true
    fallback: cloud  # if spot reclaimed, use cloud models
```

Running `clawforce deploy` would generate the appropriate docker-compose.yml, Terraform configs, or Kubernetes manifests based on the infrastructure mode. This is planned for Phase 2C (Deployment & Operations Tooling).

---

## Quick Start: Recommended First Deployment

For teams getting started with Clawforce:

1. **Start cloud-only** on a $10-20/mo VPS with customer's own API keys
2. **Validate the agent workflow** works end-to-end with cloud models
3. **Add a local model** (Ollama on a Vast.ai RTX 4090, ~$250/mo) when ready to optimize costs
4. **Enable the router** to split traffic between local and cloud based on PII/complexity
5. **Scale to split architecture** when adding more agents or moving to production

This progression lets teams validate value before committing to GPU infrastructure, and matches the recommended pricing rollout (Phase 1: free pilot → Phase 2: paid with own keys → Phase 3: full hybrid billing).
