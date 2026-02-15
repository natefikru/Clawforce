/**
 * Pre-built compliance framework profiles.
 *
 * Each profile specifies which PII pattern types must be active and the
 * minimum data classification tier required by the framework. Operators
 * list their applicable frameworks in config; the router enforces the
 * union of all required patterns and the most restrictive tier.
 */

import type { DataTier } from "./data-policy.js";

export type ComplianceFramework = "hipaa" | "pci-dss" | "gdpr" | "ccpa" | "sox";

export interface ComplianceProfile {
  framework: ComplianceFramework;
  requiredPatterns: string[];
  minimumTier: DataTier;
  description: string;
}

const TIER_ORDER: DataTier[] = ["public", "internal", "confidential", "restricted"];

export const COMPLIANCE_PROFILES: Record<ComplianceFramework, ComplianceProfile> = {
  hipaa: {
    framework: "hipaa",
    requiredPatterns: ["ssn", "dob", "email", "phone"],
    minimumTier: "confidential",
    description: "HIPAA — Protected Health Information",
  },
  "pci-dss": {
    framework: "pci-dss",
    requiredPatterns: ["credit_card", "credit_card_amex", "iban"],
    minimumTier: "restricted",
    description: "PCI-DSS — Payment Card Data",
  },
  gdpr: {
    framework: "gdpr",
    requiredPatterns: ["email", "phone", "ip_address", "dob"],
    minimumTier: "confidential",
    description: "GDPR — EU Personal Data",
  },
  ccpa: {
    framework: "ccpa",
    requiredPatterns: ["email", "phone", "ssn", "drivers_license", "ip_address"],
    minimumTier: "confidential",
    description: "CCPA — California Consumer Privacy",
  },
  sox: {
    framework: "sox",
    requiredPatterns: ["email", "ssn"],
    minimumTier: "internal",
    description: "SOX — Financial Reporting Controls",
  },
};

/**
 * Get the union of all required PII pattern names across the given frameworks.
 */
export function getRequiredPatterns(frameworks: ComplianceFramework[]): string[] {
  const patterns = new Set<string>();
  for (const fw of frameworks) {
    const profile = COMPLIANCE_PROFILES[fw];
    if (profile) {
      for (const p of profile.requiredPatterns) {
        patterns.add(p);
      }
    }
  }
  return [...patterns];
}

/**
 * Get the most restrictive minimum tier across the given frameworks.
 */
export function getMinimumTier(frameworks: ComplianceFramework[]): DataTier {
  let maxIdx = 0;
  for (const fw of frameworks) {
    const profile = COMPLIANCE_PROFILES[fw];
    if (profile) {
      const idx = TIER_ORDER.indexOf(profile.minimumTier);
      if (idx > maxIdx) maxIdx = idx;
    }
  }
  return TIER_ORDER[maxIdx];
}
