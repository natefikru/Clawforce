import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_PROFILES,
  getRequiredPatterns,
  getMinimumTier,
  type ComplianceFramework,
} from "../../../../src/plugins/clawforce-router/compliance-profiles.js";

describe("COMPLIANCE_PROFILES", () => {
  it("should define all five frameworks", () => {
    const keys = Object.keys(COMPLIANCE_PROFILES);
    expect(keys).toContain("hipaa");
    expect(keys).toContain("pci-dss");
    expect(keys).toContain("gdpr");
    expect(keys).toContain("ccpa");
    expect(keys).toContain("sox");
    expect(keys).toHaveLength(5);
  });

  it("should have non-empty requiredPatterns for each framework", () => {
    for (const profile of Object.values(COMPLIANCE_PROFILES)) {
      expect(profile.requiredPatterns.length).toBeGreaterThan(0);
    }
  });
});

describe("getRequiredPatterns", () => {
  it("should return HIPAA patterns", () => {
    const patterns = getRequiredPatterns(["hipaa"]);
    expect(patterns).toContain("ssn");
    expect(patterns).toContain("dob");
    expect(patterns).toContain("email");
    expect(patterns).toContain("phone");
  });

  it("should return PCI-DSS patterns", () => {
    const patterns = getRequiredPatterns(["pci-dss"]);
    expect(patterns).toContain("credit_card");
    expect(patterns).toContain("credit_card_amex");
    expect(patterns).toContain("iban");
  });

  it("should return union of patterns for multiple frameworks", () => {
    const patterns = getRequiredPatterns(["hipaa", "pci-dss"]);
    // HIPAA patterns
    expect(patterns).toContain("ssn");
    expect(patterns).toContain("dob");
    // PCI-DSS patterns
    expect(patterns).toContain("credit_card");
    expect(patterns).toContain("iban");
    // shared
    expect(patterns).toContain("email");
  });

  it("should deduplicate shared patterns", () => {
    const patterns = getRequiredPatterns(["hipaa", "gdpr"]);
    const emailCount = patterns.filter((p) => p === "email").length;
    expect(emailCount).toBe(1);
  });

  it("should return empty array for empty input", () => {
    expect(getRequiredPatterns([])).toEqual([]);
  });

  it("should ignore unknown frameworks gracefully", () => {
    const patterns = getRequiredPatterns(["hipaa", "unknown" as ComplianceFramework]);
    expect(patterns).toContain("ssn");
    expect(patterns.length).toBeGreaterThan(0);
  });
});

describe("getMinimumTier", () => {
  it("should return confidential for HIPAA", () => {
    expect(getMinimumTier(["hipaa"])).toBe("confidential");
  });

  it("should return restricted for PCI-DSS", () => {
    expect(getMinimumTier(["pci-dss"])).toBe("restricted");
  });

  it("should return internal for SOX", () => {
    expect(getMinimumTier(["sox"])).toBe("internal");
  });

  it("should return most restrictive tier across frameworks", () => {
    // HIPAA = confidential, PCI-DSS = restricted → restricted wins
    expect(getMinimumTier(["hipaa", "pci-dss"])).toBe("restricted");
  });

  it("should return most restrictive when SOX + HIPAA combined", () => {
    // SOX = internal, HIPAA = confidential → confidential wins
    expect(getMinimumTier(["sox", "hipaa"])).toBe("confidential");
  });

  it("should return public for empty input", () => {
    expect(getMinimumTier([])).toBe("public");
  });

  it("should handle all five frameworks and return restricted", () => {
    const all: ComplianceFramework[] = ["hipaa", "pci-dss", "gdpr", "ccpa", "sox"];
    expect(getMinimumTier(all)).toBe("restricted");
  });
});
