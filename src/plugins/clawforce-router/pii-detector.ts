/**
 * Regex-based PII detection for model routing decisions.
 * Scans text for SSN, credit card numbers, emails, phone numbers,
 * and configurable keyword blocklists.
 */

export interface PIIDetectorOptions {
  /** Additional keywords that indicate sensitive content */
  blocklist?: string[];
}

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // SSN: 123-45-6789 or 123 45 6789
  { name: "ssn", pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/ },
  // Credit card: 16 digits with optional separators
  { name: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/ },
  // Email address
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  // US phone: (123) 456-7890, 123-456-7890, +1-123-456-7890
  { name: "phone", pattern: /\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}\b/ },
];

export function detectPII(text: string, options?: PIIDetectorOptions): boolean {
  if (!text) return false;

  for (const { pattern } of PII_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  if (options?.blocklist) {
    const lower = text.toLowerCase();
    for (const keyword of options.blocklist) {
      if (lower.includes(keyword.toLowerCase())) return true;
    }
  }

  return false;
}

export function detectPIITypes(
  text: string,
  options?: PIIDetectorOptions,
): string[] {
  if (!text) return [];

  const found: string[] = [];

  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(text)) found.push(name);
  }

  if (options?.blocklist) {
    const lower = text.toLowerCase();
    for (const keyword of options.blocklist) {
      if (lower.includes(keyword.toLowerCase())) {
        found.push("blocklist");
        break;
      }
    }
  }

  return found;
}
