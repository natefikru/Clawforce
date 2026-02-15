import { describe, it, expect } from "vitest";
import { filterOutput } from "../../../../src/plugins/clawforce-router/output-filter.js";

describe("filterOutput", () => {
  it("should return unchanged for clean text", () => {
    const result = filterOutput("This is a normal response.");
    expect(result.redacted).toBe(false);
    expect(result.content).toBe("This is a normal response.");
    expect(result.matchCount).toBe(0);
    expect(result.redactedTypes).toEqual([]);
  });

  it("should return unchanged for empty string", () => {
    const result = filterOutput("");
    expect(result.redacted).toBe(false);
    expect(result.content).toBe("");
  });

  it("should redact SSN with marker", () => {
    const result = filterOutput("The SSN is 123-45-6789 on file.");
    expect(result.redacted).toBe(true);
    expect(result.content).toBe("The SSN is [SSN_REDACTED] on file.");
    expect(result.matchCount).toBe(1);
    expect(result.redactedTypes).toContain("ssn");
  });

  it("should redact email with marker", () => {
    const result = filterOutput("Contact john@example.com for info.");
    expect(result.redacted).toBe(true);
    expect(result.content).toBe("Contact [EMAIL_REDACTED] for info.");
    expect(result.redactedTypes).toContain("email");
  });

  it("should redact credit card with marker", () => {
    const result = filterOutput("Card: 4111-1111-1111-1111 is valid.");
    expect(result.redacted).toBe(true);
    expect(result.content).toBe("Card: [CREDIT_CARD_REDACTED] is valid.");
    expect(result.redactedTypes).toContain("credit_card");
  });

  it("should redact multiple PII types in one string", () => {
    const result = filterOutput(
      "SSN 123-45-6789 and email john@example.com",
    );
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[SSN_REDACTED]");
    expect(result.content).toContain("[EMAIL_REDACTED]");
    expect(result.matchCount).toBeGreaterThanOrEqual(2);
    expect(result.redactedTypes).toContain("ssn");
    expect(result.redactedTypes).toContain("email");
  });

  it("should preserve surrounding text", () => {
    const result = filterOutput("Before 123-45-6789 after");
    expect(result.content).toBe("Before [SSN_REDACTED] after");
  });

  it("should redact blocklist keywords", () => {
    const result = filterOutput("This is a secret project.", {
      blocklist: ["secret"],
    });
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[BLOCKLIST_REDACTED]");
    expect(result.redactedTypes).toContain("blocklist");
  });

  it("should redact IP address", () => {
    const result = filterOutput("Server 192.168.1.100 responded.");
    expect(result.redacted).toBe(true);
    expect(result.content).toBe("Server [IP_ADDRESS_REDACTED] responded.");
  });

  it("should handle multiple matches of the same type", () => {
    const result = filterOutput("john@a.com and jane@b.com both emailed.");
    expect(result.redacted).toBe(true);
    const emailCount = (result.content.match(/\[EMAIL_REDACTED\]/g) ?? []).length;
    expect(emailCount).toBe(2);
    // redactedTypes should still be deduplicated
    expect(result.redactedTypes.filter((t) => t === "email").length).toBe(1);
  });

  it("should handle phone number redaction", () => {
    const result = filterOutput("Call 555-123-4567 for help.");
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[PHONE_REDACTED]");
  });

  it("should redact SSN with zero-width characters inserted", () => {
    const result = filterOutput("SSN: 123\u200B-45\u200B-6789");
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[SSN_REDACTED]");
    expect(result.content).not.toContain("6789");
  });

  it("should redact email with Cyrillic homoglyphs", () => {
    // Cyrillic 'а' (U+0430) instead of Latin 'a'
    const result = filterOutput("Contact: user@ex\u0430mple.com");
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[EMAIL_REDACTED]");
  });

  it("should normalize output even when no PII found", () => {
    const result = filterOutput("Clean text\u200B with zero-width chars");
    expect(result.redacted).toBe(false);
    // Zero-width chars should be stripped in output
    expect(result.content).not.toContain("\u200B");
    expect(result.content).toBe("Clean text with zero-width chars");
  });

  it("should handle multiple PII instances without corruption", () => {
    const result = filterOutput("SSN 123-45-6789 and another 987-65-4321");
    expect(result.redacted).toBe(true);
    expect(result.content).toContain("[SSN_REDACTED]");
    expect(result.content).not.toContain("6789");
    expect(result.content).not.toContain("4321");
    expect(result.matchCount).toBe(2);
  });
});
