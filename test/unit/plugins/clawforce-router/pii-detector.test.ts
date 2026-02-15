import { describe, it, expect } from "vitest";
import {
  detectPII,
  detectPIITypes,
} from "../../../../src/plugins/clawforce-router/pii-detector.js";

describe("detectPII", () => {
  describe("SSN detection", () => {
    it("should detect SSN with dashes", () => {
      expect(detectPII("my ssn is 123-45-6789")).toBe(true);
    });

    it("should detect SSN with spaces", () => {
      expect(detectPII("ssn: 123 45 6789")).toBe(true);
    });

    it("should not match partial SSN-like numbers", () => {
      expect(detectPII("order 12345678")).toBe(false);
    });

    it("should not match SSN without proper grouping", () => {
      expect(detectPII("123456789")).toBe(false);
    });
  });

  describe("credit card detection", () => {
    it("should detect credit card with dashes", () => {
      expect(detectPII("card: 4111-1111-1111-1111")).toBe(true);
    });

    it("should detect credit card with spaces", () => {
      expect(detectPII("card: 4111 1111 1111 1111")).toBe(true);
    });

    it("should detect credit card without separators", () => {
      expect(detectPII("card: 4111111111111111")).toBe(true);
    });

    it("should not match short number sequences", () => {
      expect(detectPII("order #12345678")).toBe(false);
    });
  });

  describe("email detection", () => {
    it("should detect standard email", () => {
      expect(detectPII("contact john@example.com please")).toBe(true);
    });

    it("should detect email with subdomains", () => {
      expect(detectPII("user@mail.example.co.uk")).toBe(true);
    });

    it("should detect email with plus addressing", () => {
      expect(detectPII("john+test@gmail.com")).toBe(true);
    });

    it("should not match @ without domain", () => {
      expect(detectPII("hello @everyone")).toBe(false);
    });
  });

  describe("phone number detection", () => {
    it("should detect US phone with dashes", () => {
      expect(detectPII("call 555-123-4567")).toBe(true);
    });

    it("should detect US phone with parentheses", () => {
      expect(detectPII("call (555) 123-4567")).toBe(true);
    });

    it("should detect US phone with country code", () => {
      expect(detectPII("call +1-555-123-4567")).toBe(true);
    });

    it("should detect US phone with dots", () => {
      expect(detectPII("call 555.123.4567")).toBe(true);
    });
  });

  describe("keyword blocklist", () => {
    it("should detect blocklisted keywords", () => {
      expect(
        detectPII("send the password reset", { blocklist: ["password"] }),
      ).toBe(true);
    });

    it("should be case-insensitive for keywords", () => {
      expect(
        detectPII("my PASSWORD is...", { blocklist: ["password"] }),
      ).toBe(true);
    });

    it("should check all keywords in blocklist", () => {
      expect(
        detectPII("here is the secret key", {
          blocklist: ["password", "secret"],
        }),
      ).toBe(true);
    });

    it("should not match when no keywords found", () => {
      expect(
        detectPII("just a normal message", { blocklist: ["password"] }),
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should return false for empty string", () => {
      expect(detectPII("")).toBe(false);
    });

    it("should return false for undefined-like empty text", () => {
      expect(detectPII("")).toBe(false);
    });

    it("should return false for normal text", () => {
      expect(detectPII("What is the weather in New York?")).toBe(false);
    });

    it("should detect multiple PII types in one message", () => {
      expect(
        detectPII("email: john@example.com, ssn: 123-45-6789"),
      ).toBe(true);
    });

    it("should work without options", () => {
      expect(detectPII("just text")).toBe(false);
    });

    it("should work with empty blocklist", () => {
      expect(detectPII("just text", { blocklist: [] })).toBe(false);
    });
  });
});

describe("detectPIITypes", () => {
  it("should return all detected PII types", () => {
    const types = detectPIITypes("email: john@example.com, ssn: 123-45-6789");
    expect(types).toContain("ssn");
    expect(types).toContain("email");
  });

  it("should return blocklist when keyword matched", () => {
    const types = detectPIITypes("send the password", {
      blocklist: ["password"],
    });
    expect(types).toContain("blocklist");
  });

  it("should return empty array for clean text", () => {
    expect(detectPIITypes("hello world")).toEqual([]);
  });

  it("should return empty array for empty string", () => {
    expect(detectPIITypes("")).toEqual([]);
  });

  it("should not duplicate blocklist entry for multiple keyword matches", () => {
    const types = detectPIITypes("password and secret stuff", {
      blocklist: ["password", "secret"],
    });
    const blocklistCount = types.filter((t) => t === "blocklist").length;
    expect(blocklistCount).toBe(1);
  });
});
