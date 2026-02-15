import { describe, it, expect } from "vitest";
import {
  detectDomain,
  type TaskDomain,
} from "../../../../src/plugins/clawforce-router/domain-detector.js";

describe("detectDomain", () => {
  describe("code domain", () => {
    it("should detect code with programming keywords", () => {
      const result = detectDomain("Fix the bug in the function that handles async callbacks");
      expect(result.domain).toBe("code");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedIndicators.length).toBeGreaterThan(0);
    });

    it("should detect code with code blocks", () => {
      const result = detectDomain("What does this do:\n```\nconst x = 1;\n```");
      expect(result.domain).toBe("code");
    });

    it("should detect code with file extensions", () => {
      const result = detectDomain("Refactor the handler in server.ts to use middleware");
      expect(result.domain).toBe("code");
    });

    it("should detect code with tooling references", () => {
      const result = detectDomain("Run npm install and then docker build the container");
      expect(result.domain).toBe("code");
    });

    it("should detect code with error debugging", () => {
      const result = detectDomain("I have a compile error when I try to import the class and catch the throw");
      expect(result.domain).toBe("code");
    });
  });

  describe("writing domain", () => {
    it("should detect writing with drafting keywords", () => {
      const result = detectDomain("Write a blog post about machine learning and summarize the key points");
      expect(result.domain).toBe("writing");
    });

    it("should detect writing with editing requests", () => {
      const result = detectDomain("Proofread this essay and fix the grammar and tone");
      expect(result.domain).toBe("writing");
    });

    it("should detect writing with creative requests", () => {
      const result = detectDomain("Draft a creative narrative with good prose and storytelling");
      expect(result.domain).toBe("writing");
    });

    it("should detect writing with copywriting", () => {
      const result = detectDomain("Write a headline and tagline for our new product slogan");
      expect(result.domain).toBe("writing");
    });
  });

  describe("analysis domain", () => {
    it("should detect analysis with comparison keywords", () => {
      const result = detectDomain("Analyze the growth trends and compare the performance metrics across regions");
      expect(result.domain).toBe("analysis");
    });

    it("should detect analysis with evaluation requests", () => {
      const result = detectDomain("Evaluate the tradeoff between strategy A and B and give a recommendation with impact assessment");
      expect(result.domain).toBe("analysis");
    });

    it("should detect analysis with forecasting", () => {
      const result = detectDomain("Predict the growth forecast based on current benchmark performance and decline patterns");
      expect(result.domain).toBe("analysis");
    });
  });

  describe("data domain", () => {
    it("should detect data with extraction keywords", () => {
      const result = detectDomain("Extract the data from the CSV and parse the JSON to build a table with columns");
      expect(result.domain).toBe("data");
    });

    it("should detect data with SQL references", () => {
      const result = detectDomain("Write a SQL query to filter and aggregate the dataset by column");
      expect(result.domain).toBe("data");
    });

    it("should detect data with ETL concepts", () => {
      const result = detectDomain("Build an ETL pipeline to transform and filter the database schema");
      expect(result.domain).toBe("data");
    });

    it("should detect data with scraping", () => {
      const result = detectDomain("Scrape the table rows using regex and parse into a spreadsheet");
      expect(result.domain).toBe("data");
    });
  });

  describe("conversation domain", () => {
    it("should classify short greetings as conversation", () => {
      const result = detectDomain("Hello, how are you?");
      expect(result.domain).toBe("conversation");
    });

    it("should classify simple questions as conversation", () => {
      const result = detectDomain("What time is it?");
      expect(result.domain).toBe("conversation");
    });

    it("should classify short text without domain signals as conversation", () => {
      const result = detectDomain("Tell me a joke");
      expect(result.domain).toBe("conversation");
    });

    it("should classify ambiguous short text as conversation", () => {
      const result = detectDomain("Thanks for the help!");
      expect(result.domain).toBe("conversation");
    });
  });

  describe("edge cases", () => {
    it("should return conversation for empty string", () => {
      const result = detectDomain("");
      expect(result.domain).toBe("conversation");
      expect(result.confidence).toBe(1);
      expect(result.matchedIndicators).toEqual([]);
    });

    it("should return conversation for whitespace-only string", () => {
      const result = detectDomain("   ");
      expect(result.domain).toBe("conversation");
    });

    it("should be case-insensitive", () => {
      const result = detectDomain("FIX THE BUG IN THE FUNCTION THAT HANDLES ASYNC IMPORT");
      expect(result.domain).toBe("code");
    });

    it("should handle mixed domain signals by picking the strongest", () => {
      // More code signals than writing signals
      const result = detectDomain("Write a function that handles async callbacks with try catch and return the promise");
      expect(result.domain).toBe("code");
    });

    it("should return confidence between 0 and 1", () => {
      const result = detectDomain("Refactor the function to use async await with try catch blocks");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should include matched indicators in result", () => {
      const result = detectDomain("Parse the CSV and filter the JSON dataset");
      expect(result.matchedIndicators).toContain("csv");
      expect(result.matchedIndicators).toContain("json");
      expect(result.matchedIndicators).toContain("filter");
    });

    it("should handle long text with no domain signals as conversation", () => {
      const words = "the quick brown fox jumps over the lazy dog and then the cat sat on the mat while birds flew overhead in the clear blue sky on a warm summer afternoon";
      const result = detectDomain(words);
      expect(result.domain).toBe("conversation");
    });

    it("should produce consistent results on repeated calls", () => {
      const input = "Fix the bug in the async function import";
      const r1 = detectDomain(input);
      const r2 = detectDomain(input);
      const r3 = detectDomain(input);
      expect(r1.domain).toBe(r2.domain);
      expect(r2.domain).toBe(r3.domain);
      expect(r1.confidence).toBe(r2.confidence);
    });
  });
});
