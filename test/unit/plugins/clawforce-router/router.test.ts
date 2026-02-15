import { describe, it, expect } from "vitest";
import {
  selectModel,
  getDefaultRules,
  type RoutingRule,
} from "../../../../src/plugins/clawforce-router/router.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
const LOCAL_MODEL = "ollama/llama3.3:8b";

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
        { condition: "pii_detected", model: "custom/local-model" },
      ];
      const result = selectModel({
        hasPII: true,
        complexity: "medium",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("custom/local-model");
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

    it("should work with empty rules array", () => {
      const result = selectModel({
        hasPII: true,
        complexity: "high",
        rules: [],
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe(DEFAULT_MODEL);
      expect(result.reason).toContain("default");
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
        { condition: "pii_detected", model: "first-model" },
        { condition: "pii_detected", model: "second-model" },
      ];
      const result = selectModel({
        hasPII: true,
        complexity: "low",
        rules,
        defaultModel: DEFAULT_MODEL,
      });
      expect(result.model).toBe("first-model");
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
