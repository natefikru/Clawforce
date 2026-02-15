import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { routeTest, formatRouteTestResult } from "../../../src/commands/route-test.js";

const fixturesDir = join(import.meta.dirname, "../../fixtures");
const basicConfig = join(fixturesDir, "full-phase1-config.yaml");
const fiveDimConfig = join(fixturesDir, "full-5d-config.yaml");

describe("routeTest", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
  });

  it("detects PII and routes to local model", () => {
    const result = routeTest(basicConfig, "My SSN is 123-45-6789, please help");
    expect(result.model).toBe("ollama/llama3.3:8b");
    expect(result.hasPII).toBe(true);
    expect(result.piiTypes.length).toBeGreaterThan(0);
    expect(result.dimension).toBe("sensitivity");
  });

  it("routes simple prompt to low complexity model", () => {
    const result = routeTest(basicConfig, "Hi there");
    expect(result.model).toBe("ollama/llama3.3:8b");
    expect(result.complexity).toBe("low");
    expect(result.hasPII).toBe(false);
  });

  it("routes complex prompt to high complexity model", () => {
    const result = routeTest(
      basicConfig,
      "First, analyze the distributed systems architecture and compare microservices vs monolith patterns. Second, evaluate the trade-offs of eventual consistency including performance implications. Third, provide a detailed technical report with recommendations for scalability, fault tolerance, and optimization strategies. Finally, compare these approaches across multiple dimensions and summarize the key architectural decisions with concrete implementation steps for each recommendation in the final comprehensive analysis report",
    );
    expect(result.complexity).toBe("high");
  });

  it("detects code domain with 5D config", () => {
    const result = routeTest(
      fiveDimConfig,
      "Fix the bug in this TypeScript function that imports React and uses useState with async/await in the useEffect hook",
    );
    expect(result.domain).toBe("code");
  });

  it("detects writing domain with 5D config", () => {
    const result = routeTest(
      fiveDimConfig,
      "Write a blog post draft about the future of AI. Edit the tone to be more professional and proofread for grammar",
    );
    expect(result.domain).toBe("writing");
  });

  it("PII takes priority over domain in default priority", () => {
    const result = routeTest(
      fiveDimConfig,
      "Fix the bug in this function. My SSN is 123-45-6789 and my email is user@test.com",
    );
    expect(result.model).toBe("ollama/llama3.3:8b");
    expect(result.hasPII).toBe(true);
    expect(result.dimension).toBe("sensitivity");
  });

  it("returns default model for conversation prompts", () => {
    const result = routeTest(basicConfig, "Hello, how are you?");
    // Low complexity, no domain, no PII → low_complexity rule
    expect(result.hasPII).toBe(false);
    expect(result.domain).toBe("conversation");
  });

  it("includes budget info when configured", () => {
    const result = routeTest(fiveDimConfig, "Hello");
    expect(result.budgetRemaining).toBeLessThan(Infinity);
    expect(result.budgetSpent).toBeGreaterThanOrEqual(0);
  });

  it("shows infinite budget when not configured", () => {
    const result = routeTest(basicConfig, "Hello");
    expect(result.budgetRemaining).toBe(Infinity);
  });

  it("includes matched condition when a rule matches", () => {
    const result = routeTest(
      basicConfig,
      "My credit card number is 4111-1111-1111-1111",
    );
    expect(result.matchedCondition).toBe("pii_detected");
  });

  it("detects custom sensitivity keywords", () => {
    const result = routeTest(
      basicConfig,
      "The password is supersecret123 and the secret key is ABC",
    );
    expect(result.hasPII).toBe(true);
    expect(result.model).toBe("ollama/llama3.3:8b");
  });
});

describe("formatRouteTestResult", () => {
  it("formats basic result with all dimensions", () => {
    const output = formatRouteTestResult({
      model: "anthropic/claude-sonnet-4-5",
      reason: "Default model",
      hasPII: false,
      piiTypes: [],
      complexity: "medium",
      domain: "conversation",
      domainConfidence: 0,
      budgetSpent: 0,
      budgetRemaining: Infinity,
    });

    expect(output).toContain("Model: anthropic/claude-sonnet-4-5");
    expect(output).toContain("PII: no");
    expect(output).toContain("Complexity: medium");
    expect(output).toContain("Domain: conversation");
    expect(output).toContain("Budget: not configured");
  });

  it("formats PII result with types", () => {
    const output = formatRouteTestResult({
      model: "ollama/llama3.3:8b",
      reason: "PII detected",
      dimension: "sensitivity",
      hasPII: true,
      piiTypes: ["ssn", "email"],
      complexity: "low",
      domain: "conversation",
      domainConfidence: 0,
      budgetSpent: 0,
      budgetRemaining: Infinity,
      matchedCondition: "pii_detected",
    });

    expect(output).toContain("PII: yes (ssn, email)");
    expect(output).toContain("Matched Rule: pii_detected");
    expect(output).toContain("Winning Dimension: sensitivity");
  });

  it("formats budget info when configured", () => {
    const output = formatRouteTestResult({
      model: "ollama/llama3.3:8b",
      reason: "Over budget",
      dimension: "cost",
      hasPII: false,
      piiTypes: [],
      complexity: "medium",
      domain: "conversation",
      domainConfidence: 0,
      budgetSpent: 8.5,
      budgetRemaining: 1.5,
      matchedCondition: "over_budget",
    });

    expect(output).toContain("Budget: $8.50/$10.00 remaining");
    expect(output).not.toContain("not configured");
  });
});
