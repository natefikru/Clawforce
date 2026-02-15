import { describe, it, expect } from "vitest";
import {
  selectModel,
  getDefaultRules,
  type RoutingRule,
  type RoutingDimension,
} from "../../../../src/plugins/clawforce-router/router.js";
import type { BudgetCheck } from "../../../../src/plugins/clawforce-router/budget-tracker.js";
import { isLocalModel } from "../../../../src/shared/pricing.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
const LOCAL_MODEL = "sglang/qwen3-32b";

const defaultRules = getDefaultRules();

describe("selectModel", () => {
  describe("PII priority", () => {
    it("should route to local model when PII detected", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
      expect(result.reason).toContain("PII");
    });

    it("should override complexity when PII detected", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
    });

    it("should use PII rule model even with custom rules", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "ollama/custom-model" },
      ];
      const result = selectModel({
        hasPII: true,
        complexity: "medium",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("ollama/custom-model");
    });

    it("should include matched rule in decision", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule?.condition).toBe("pii_detected");
    });
  });

  describe("complexity-based routing", () => {
    it("should route low complexity to cost-efficient model", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
      expect(result.reason).toContain("cost-efficient");
    });

    it("should route high complexity to capable model", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-sonnet-4-5");
      expect(result.reason).toContain("capable");
    });

    it("should use default model for medium complexity", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(DEFAULT_MODEL);
      expect(result.reason).toContain("default");
    });
  });

  describe("custom rules", () => {
    it("should use custom model for low complexity", () => {
      const rules: RoutingRule[] = [
        { condition: "low_complexity", model: "openai/gpt-4o-mini" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "low",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("openai/gpt-4o-mini");
    });

    it("should use custom model for high complexity", () => {
      const rules: RoutingRule[] = [
        { condition: "high_complexity", model: "anthropic/claude-opus-4" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-opus-4");
    });

    it("should fall through to default when no rule matches", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: LOCAL_MODEL },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(DEFAULT_MODEL);
    });

    it("should route PII to local with empty rules array (hard invariant)", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: [],
        defaultModel: DEFAULT_MODEL,
      });
      // Hard invariant: PII always routes local, even with empty rules
      expect(
        result.model.startsWith("ollama/") || result.model.startsWith("local/") || result.model.startsWith("sglang/") || result.model.startsWith("vllm/"),
      ).toBe(true);
      expect(result.reason).toContain("enforcing local-only invariant");
    });
  });

  describe("edge cases", () => {
    it("should return no matchedRule when falling to default", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.matchedRule).toBeUndefined();
    });

    it("should use first matching PII rule if duplicates exist", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "local/first-model" },
        { condition: "pii_detected", model: "local/second-model" },
      ];
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("local/first-model");
    });

    it("should not match PII rule when hasPII is false", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: LOCAL_MODEL },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "low",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(DEFAULT_MODEL);
    });
  });
});

describe("getDefaultRules", () => {
  it("should return 3 default rules", () => {
    expect(getDefaultRules()).toHaveLength(3);
  });

  it("should include pii_detected rule", () => {
    expect(getDefaultRules().some((r) => r.condition === "pii_detected")).toBe(
      true,
    );
  });

  it("should include low_complexity rule", () => {
    expect(
      getDefaultRules().some((r) => r.condition === "low_complexity"),
    ).toBe(true);
  });

  it("should include high_complexity rule", () => {
    expect(
      getDefaultRules().some((r) => r.condition === "high_complexity"),
    ).toBe(true);
  });

  it("should return a copy (not the original array)", () => {
    const rules1 = getDefaultRules();
    const rules2 = getDefaultRules();
    expect(rules1).not.toBe(rules2);
    expect(rules1).toEqual(rules2);
  });
});

describe("multi-dimensional routing", () => {
  const withinBudget: BudgetCheck = {
    withinBudget: true,
    remainingBudget: 8,
    dailySpent: 2,
  };

  const overBudget: BudgetCheck = {
    withinBudget: false,
    remainingBudget: 0,
    suggestedModel: "sglang/qwen3-32b",
    dailySpent: 10,
  };

  describe("domain routing", () => {
    it("should route code domain to code model", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_code", model: "deepseek/deepseek-coder-v2" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        domain: "code",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("deepseek/deepseek-coder-v2");
      expect(result.reason).toContain("code");
    });

    it("should route writing domain to writing model", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_writing", model: "anthropic/claude-sonnet-4-5" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        domain: "writing",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-sonnet-4-5");
    });

    it("should route analysis domain to analysis model", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_analysis", model: "anthropic/claude-opus-4" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        domain: "analysis",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-opus-4");
    });

    it("should route data domain to data model", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_data", model: "openai/gpt-4o" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        domain: "data",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("openai/gpt-4o");
    });

    it("should not match domain rules for conversation", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_code", model: "deepseek/deepseek-coder-v2" },
        { condition: "low_complexity", model: LOCAL_MODEL },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "low",
        domain: "conversation",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
    });
  });

  describe("budget routing", () => {
    it("should route to fallback when over budget", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        budgetCheck: overBudget,
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
      expect(result.reason).toContain("budget");
    });

    it("should use over_budget rule when defined", () => {
      const rules: RoutingRule[] = [
        { condition: "over_budget", model: "openai/gpt-4o-mini" },
        { condition: "high_complexity", model: "anthropic/claude-opus-4" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        budgetCheck: overBudget,
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("openai/gpt-4o-mini");
    });

    it("should not trigger budget routing when within budget", () => {
      const rules: RoutingRule[] = [
        { condition: "over_budget", model: "openai/gpt-4o-mini" },
        { condition: "high_complexity", model: "anthropic/claude-opus-4" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        budgetCheck: withinBudget,
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-opus-4");
    });
  });

  describe("priority ordering", () => {
    it("should respect default priority: sensitivity > cost > domain > complexity", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "local/pii" },
        { condition: "over_budget", model: "local/budget" },
        { condition: "domain_code", model: "code/model" },
        { condition: "high_complexity", model: "high/model" },
      ];
      // PII wins over all
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        domain: "code",
        budgetCheck: overBudget,
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("local/pii");
      expect(result.dimension).toBe("sensitivity");
    });

    it("should let cost win over domain and complexity when PII is absent", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "local/pii" },
        { condition: "over_budget", model: "local/budget" },
        { condition: "domain_code", model: "code/model" },
        { condition: "high_complexity", model: "high/model" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        domain: "code",
        budgetCheck: overBudget,
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("local/budget");
      expect(result.dimension).toBe("cost");
    });

    it("should let domain win over complexity when budget is ok", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_code", model: "code/model" },
        { condition: "high_complexity", model: "high/model" },
      ];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        domain: "code",
        budgetCheck: withinBudget,
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("code/model");
      expect(result.dimension).toBe("domain");
    });

    it("should allow custom priority ordering for non-PII prompts", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "local/pii" },
        { condition: "domain_code", model: "code/model" },
        { condition: "high_complexity", model: "high/model" },
      ];
      // Domain first, then sensitivity
      const priority: RoutingDimension[] = ["domain", "sensitivity", "complexity"];
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        domain: "code",
        rules,
        defaultModel: DEFAULT_MODEL,
        priority,
      });
      // No PII — domain evaluated first, matches domain_code
      expect(result.model).toBe("code/model");
      expect(result.dimension).toBe("domain");
    });

    it("should enforce PII safety invariant regardless of priority ordering", () => {
      const rules: RoutingRule[] = [
        { condition: "pii_detected", model: "local/pii" },
        { condition: "domain_code", model: "code/model" },
      ];
      // Domain first — would normally pick code/model before sensitivity
      const priority: RoutingDimension[] = ["domain", "sensitivity", "complexity"];
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        domain: "code",
        rules,
        defaultModel: DEFAULT_MODEL,
        priority,
      });
      // Post-routing PII invariant overrides cloud domain model to local
      expect(isLocalModel(result.model)).toBe(true);
      expect(result.dimension).toBe("sensitivity");
    });

    it("should use defaultLocalModel in PII safety invariant when provided", () => {
      const rules: RoutingRule[] = [
        { condition: "domain_code", model: "anthropic/claude-sonnet-4-5" },
      ];
      const priority: RoutingDimension[] = ["domain", "sensitivity"];
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        domain: "code",
        rules,
        defaultModel: DEFAULT_MODEL,
        defaultLocalModel: "ollama/custom-local:7b",
        priority,
      });
      expect(result.model).toBe("ollama/custom-local:7b");
    });
  });

  describe("backward compatibility", () => {
    it("should work without domain field", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
    });

    it("should work without budgetCheck field", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "high",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("anthropic/claude-sonnet-4-5");
    });

    it("should work without priority field", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(LOCAL_MODEL);
    });

    it("should include dimension in decision when matched", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.dimension).toBe("sensitivity");
    });

    it("should not include dimension when falling to default", () => {
      const result = selectModel({
        hasPII: false,
        complexity: "medium",
        rules: defaultRules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.dimension).toBeUndefined();
    });
  });

  describe("hard PII invariant", () => {
    const CLOUD_PROVIDERS = ["anthropic", "openai", "google", "azure"];

    it("should route PII to local even with no pii_detected rule", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: [
          { condition: "high_complexity", model: "anthropic/claude-sonnet-4-5" },
        ],
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.dimension).toBe("sensitivity");
      expect(result.reason).toContain("enforcing local-only invariant");
      // Must be a local model
      expect(
        result.model.startsWith("ollama/") || result.model.startsWith("local/") || result.model.startsWith("sglang/") || result.model.startsWith("vllm/"),
      ).toBe(true);
    });

    it("should override PII rule pointing to cloud model", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: [
          { condition: "pii_detected", model: "anthropic/claude-sonnet-4-5" },
        ],
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.dimension).toBe("sensitivity");
      expect(result.reason).toContain("overriding to local");
      for (const provider of CLOUD_PROVIDERS) {
        expect(result.model).not.toContain(provider);
      }
    });

    it("should use defaultLocalModel when overriding cloud PII rule", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: [
          { condition: "pii_detected", model: "openai/gpt-4o" },
        ],
        defaultModel: DEFAULT_MODEL,
        defaultLocalModel: "ollama/custom-local:7b",
      });
      expect(result.model).toBe("ollama/custom-local:7b");
    });

    it("should use defaultLocalModel as invariant fallback", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: [],
        defaultModel: DEFAULT_MODEL,
        defaultLocalModel: "ollama/qwen3-32b",
      });
      expect(result.model).toBe("ollama/qwen3-32b");
    });

    it("should keep valid local PII rule unchanged", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules: [
          { condition: "pii_detected", model: "sglang/qwen3-32b" },
        ],
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("sglang/qwen3-32b");
      expect(result.reason).toBe("PII detected — routing to local model");
    });

    it("SECURITY: PII with empty rules still routes local", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: [],
        defaultModel: "anthropic/claude-sonnet-4-5",
      });
      for (const provider of CLOUD_PROVIDERS) {
        expect(result.model).not.toContain(provider);
      }
    });

    it("SECURITY: PII with all cloud rules still routes local", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: [
          { condition: "pii_detected", model: "openai/gpt-4o" },
          { condition: "high_complexity", model: "anthropic/claude-opus-4" },
        ],
        defaultModel: "anthropic/claude-sonnet-4-5",
      });
      for (const provider of CLOUD_PROVIDERS) {
        expect(result.model).not.toContain(provider);
      }
    });
  });
});
