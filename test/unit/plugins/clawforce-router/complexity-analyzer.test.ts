import { describe, it, expect } from "vitest";
import {
  analyzeComplexity,
  extractFactors,
} from "../../../../src/plugins/clawforce-router/complexity-analyzer.js";

describe("analyzeComplexity", () => {
  describe("low complexity", () => {
    it("should classify short questions as low", () => {
      expect(analyzeComplexity("What time is it?")).toBe("low");
    });

    it("should classify simple greetings as low", () => {
      expect(analyzeComplexity("Hello")).toBe("low");
    });

    it("should classify short commands as low", () => {
      expect(analyzeComplexity("List my files")).toBe("low");
    });

    it("should classify empty string as low", () => {
      expect(analyzeComplexity("")).toBe("low");
    });

    it("should classify brief factual questions as low", () => {
      expect(analyzeComplexity("What is the capital of France?")).toBe("low");
    });
  });

  describe("medium complexity", () => {
    it("should classify prompts with code blocks as medium+", () => {
      const result = analyzeComplexity(
        "Fix this bug:\n```\nconst x = 1;\n```",
      );
      expect(["medium", "high"]).toContain(result);
    });

    it("should classify prompts with inline code as medium+", () => {
      const result = analyzeComplexity(
        "What does `Array.prototype.map` do and how is it different from forEach?",
      );
      expect(["medium", "high"]).toContain(result);
    });

    it("should classify moderately long prompts as medium+", () => {
      const words = Array(55).fill("word").join(" ");
      const result = analyzeComplexity(words);
      expect(["medium", "high"]).toContain(result);
    });

    it("should classify prompts with complexity keywords and moderate length as medium+", () => {
      expect(
        analyzeComplexity(
          "I need you to analyze the performance of our API endpoints and compare the response times across the different server regions we have deployed to understand the bottlenecks",
        ),
      ).toBe("medium");
    });
  });

  describe("high complexity", () => {
    it("should classify long multi-step prompts as high", () => {
      const prompt =
        "First, read the config file and understand the schema. Then, refactor the validation logic to support nested objects across all modules. Finally, add integration tests for the new behavior, optimize the error messages, and analyze the performance impact of these changes to make sure nothing regresses.";
      expect(analyzeComplexity(prompt)).toBe("high");
    });

    it("should classify prompts with code + multiple keywords as high", () => {
      const prompt =
        "Analyze and refactor this code to optimize performance:\n```\nfunction process(data) { return data.map(x => x * 2); }\n```\nAlso implement error handling.";
      expect(analyzeComplexity(prompt)).toBe("high");
    });

    it("should classify very long prompts with structure as high", () => {
      const words = Array(120).fill("word").join(" ");
      const prompt = `${words} First do this. Then do that. Finally wrap up.`;
      expect(analyzeComplexity(prompt)).toBe("high");
    });

    it("should classify step-numbered prompts with keywords as high", () => {
      const prompt =
        "Please help me with: 1) Analyze the current architecture 2) Design a new database schema 3) Implement the migration? What are the tradeoffs?";
      expect(analyzeComplexity(prompt)).toBe("high");
    });
  });

  describe("multi-step detection", () => {
    it("should detect first...then pattern", () => {
      const factors = extractFactors("First read the file, then process it");
      expect(factors.hasMultiStepMarkers).toBe(true);
    });

    it("should detect step N pattern", () => {
      const factors = extractFactors("Step 1: do this. Step 2: do that.");
      expect(factors.hasMultiStepMarkers).toBe(true);
    });

    it("should detect numbered list pattern", () => {
      const factors = extractFactors("1) Read file 2) Process 3) Save");
      expect(factors.hasMultiStepMarkers).toBe(true);
    });

    it("should detect finally keyword", () => {
      const factors = extractFactors(
        "Do the work and finally commit the changes",
      );
      expect(factors.hasMultiStepMarkers).toBe(true);
    });

    it("should detect after that pattern", () => {
      const factors = extractFactors(
        "Build the project, after that run the tests",
      );
      expect(factors.hasMultiStepMarkers).toBe(true);
    });
  });
});

describe("extractFactors", () => {
  it("should count words correctly", () => {
    const factors = extractFactors("one two three four five");
    expect(factors.wordCount).toBe(5);
  });

  it("should detect code blocks", () => {
    const factors = extractFactors("Here:\n```js\nconst x = 1;\n```");
    expect(factors.hasCodeBlocks).toBe(true);
  });

  it("should detect inline code", () => {
    const factors = extractFactors("Use `console.log` for debugging");
    expect(factors.hasCodeBlocks).toBe(true);
  });

  it("should count high complexity keywords", () => {
    const factors = extractFactors(
      "Analyze, refactor, and optimize the codebase",
    );
    expect(factors.highComplexityKeywordCount).toBe(3);
  });

  it("should count question marks", () => {
    const factors = extractFactors("Why? How? When? Where?");
    expect(factors.questionCount).toBe(4);
  });

  it("should handle empty input", () => {
    const factors = extractFactors("");
    expect(factors.wordCount).toBe(0);
    expect(factors.hasCodeBlocks).toBe(false);
    expect(factors.hasMultiStepMarkers).toBe(false);
    expect(factors.highComplexityKeywordCount).toBe(0);
    expect(factors.questionCount).toBe(0);
  });
});
