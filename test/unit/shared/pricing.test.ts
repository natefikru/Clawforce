import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  estimateRequestCost,
  isLocalModel,
  DEFAULT_PRICING,
  FALLBACK_CLOUD_PRICING,
  resetWarningCache,
} from "../../../src/shared/pricing.js";

describe("isLocalModel", () => {
  it("identifies ollama models as local", () => {
    expect(isLocalModel("ollama/llama3.3:8b")).toBe(true);
  });

  it("identifies sglang models as local", () => {
    expect(isLocalModel("sglang/qwen3-32b")).toBe(true);
  });

  it("identifies vllm models as local", () => {
    expect(isLocalModel("vllm/mistral-7b")).toBe(true);
  });

  it("identifies local/ prefix as local", () => {
    expect(isLocalModel("local/custom")).toBe(true);
  });

  it("does not treat cloud models as local", () => {
    expect(isLocalModel("anthropic/claude-sonnet-4-5")).toBe(false);
    expect(isLocalModel("openai/gpt-4o")).toBe(false);
    expect(isLocalModel("google/gemini-pro")).toBe(false);
  });
});

describe("estimateRequestCost", () => {
  beforeEach(() => {
    resetWarningCache();
  });

  it("returns 0 for local models", () => {
    expect(estimateRequestCost("ollama/llama3.3:8b", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateRequestCost("sglang/qwen3-32b", 1_000_000, 1_000_000)).toBe(0);
  });

  it("calculates correct cost for known models", () => {
    const cost = estimateRequestCost("anthropic/claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(cost).toBe(3.0 + 15.0);
  });

  it("calculates correct cost for GPT-4o-mini", () => {
    const cost = estimateRequestCost("openai/gpt-4o-mini", 1_000_000, 1_000_000);
    expect(cost).toBe(0.15 + 0.6);
  });

  it("uses conservative fallback for unknown cloud models", () => {
    const cost = estimateRequestCost("google/gemini-pro", 1_000_000, 1_000_000);
    expect(cost).toBe(FALLBACK_CLOUD_PRICING.inputPerMillion + FALLBACK_CLOUD_PRICING.outputPerMillion);
    expect(cost).toBeGreaterThan(0);
  });

  it("writes warning to stderr on first unknown model", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    estimateRequestCost("google/gemini-pro", 1000, 1000);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('No pricing data for model "google/gemini-pro"'),
    );
    stderrSpy.mockRestore();
  });

  it("only warns once per model", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    estimateRequestCost("google/gemini-pro", 1000, 1000);
    estimateRequestCost("google/gemini-pro", 1000, 1000);
    const geminiWarnings = stderrSpy.mock.calls.filter(
      (c) => String(c[0]).includes("gemini-pro"),
    );
    expect(geminiWarnings).toHaveLength(1);
    stderrSpy.mockRestore();
  });

  it("accepts custom pricing map", () => {
    const custom = {
      "custom/model": { inputPerMillion: 1.0, outputPerMillion: 2.0 },
    };
    const cost = estimateRequestCost("custom/model", 1_000_000, 1_000_000, custom);
    expect(cost).toBe(3.0);
  });

  it("scales cost proportionally to token count", () => {
    const halfMillion = estimateRequestCost("anthropic/claude-sonnet-4-5", 500_000, 500_000);
    const fullMillion = estimateRequestCost("anthropic/claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(fullMillion).toBe(halfMillion * 2);
  });
});

describe("DEFAULT_PRICING", () => {
  it("contains entries for all expected models", () => {
    expect(DEFAULT_PRICING["anthropic/claude-sonnet-4-5"]).toBeDefined();
    expect(DEFAULT_PRICING["anthropic/claude-opus-4"]).toBeDefined();
    expect(DEFAULT_PRICING["anthropic/claude-haiku-4-5"]).toBeDefined();
    expect(DEFAULT_PRICING["openai/gpt-4o"]).toBeDefined();
    expect(DEFAULT_PRICING["openai/gpt-4o-mini"]).toBeDefined();
  });
});

describe("FALLBACK_CLOUD_PRICING", () => {
  it("uses the highest common pricing tier", () => {
    for (const pricing of Object.values(DEFAULT_PRICING)) {
      expect(FALLBACK_CLOUD_PRICING.inputPerMillion).toBeGreaterThanOrEqual(pricing.inputPerMillion);
      expect(FALLBACK_CLOUD_PRICING.outputPerMillion).toBeGreaterThanOrEqual(pricing.outputPerMillion);
    }
  });
});
