/**
 * Regex-based PII detection for model routing decisions.
 * Scans text for SSN, credit card numbers, emails, phone numbers,
 * and configurable keyword blocklists.
 *
 * Includes adversarial defense: unicode normalization strips zero-width
 * characters, decomposes ligatures, and folds common homoglyphs before
 * pattern matching.
 */

export interface PIIDetectorOptions {
  /** Additional keywords that indicate sensitive content */
  blocklist?: string[];
}

/**
 * Common Cyrillic-to-Latin homoglyph mappings.
 * Attackers use visually identical Cyrillic characters to bypass regex.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  "\u0410": "A", "\u0430": "a", // А/а → A/a
  "\u0412": "B", "\u0432": "v", // В/в (note: lowercase в maps to v in Cyrillic)
  "\u0421": "C", "\u0441": "c", // С/с → C/c
  "\u0415": "E", "\u0435": "e", // Е/е → E/e
  "\u041D": "H", "\u043D": "h", // Н/н → H/h (visual match)
  "\u041A": "K", "\u043A": "k", // К/к → K/k
  "\u041C": "M", "\u043C": "m", // М/м → M/m
  "\u041E": "O", "\u043E": "o", // О/о → O/o
  "\u0420": "P", "\u0440": "p", // Р/р → P/p
  "\u0422": "T", "\u0442": "t", // Т/т → T/t
  "\u0425": "X", "\u0445": "x", // Х/х → X/x
  "\u0423": "Y", "\u0443": "y", // У/у → Y/y (visual approximation)
  // Greek homoglyphs
  "\u0391": "A", "\u03B1": "a", // Α/α → A/a
  "\u0392": "B", "\u03B2": "b", // Β/β → B/b
  "\u0395": "E", "\u03B5": "e", // Ε/ε → E/e
  "\u039F": "O", "\u03BF": "o", // Ο/ο → O/o
  "\u03A1": "P", "\u03C1": "p", // Ρ/ρ → P/p
  "\u03A4": "T", "\u03C4": "t", // Τ/τ → T/t
};

/**
 * Normalize text to defeat adversarial evasion techniques:
 * 1. Strip zero-width and invisible formatting characters
 * 2. NFKD decomposition (expands fullwidth digits, ligatures)
 * 3. Fold common homoglyphs (Cyrillic/Greek → Latin)
 */
export function normalizeText(text: string): string {
  // 1. Strip zero-width and invisible characters
  let normalized = text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, "");

  // 2. NFKD normalization: decomposes fullwidth digits (０-９ → 0-9),
  //    ligatures (ﬁ → fi), etc.
  normalized = normalized.normalize("NFKD");

  // 3. Strip combining marks left over from NFKD decomposition
  //    (e.g., accents on characters), keeping digits and basic Latin
  normalized = normalized.replace(/[\u0300-\u036F]/g, "");

  // 4. Fold homoglyphs
  normalized = foldHomoglyphs(normalized);

  return normalized;
}

function foldHomoglyphs(text: string): string {
  let result = "";
  for (const char of text) {
    result += HOMOGLYPH_MAP[char] ?? char;
  }
  return result;
}

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // SSN: 123-45-6789, 123 45 6789, or 123456789 (with optional separators)
  { name: "ssn", pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/ },
  // Credit card: 16 digits with optional separators (Visa, Mastercard, Discover)
  { name: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/ },
  // Credit card: Amex — starts with 34 or 37, 15 digits
  { name: "credit_card_amex", pattern: /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/ },
  // Email address
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  // US phone: (123) 456-7890, 123-456-7890, +1-123-456-7890
  { name: "phone", pattern: /\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}\b/ },
  // IBAN: 2 letter country code + 2 check digits + up to 30 alphanumeric
  { name: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/ },
  // Date of birth: keyword + date pattern
  { name: "dob", pattern: /\b(?:date\s*(?:of\s*)?birth|dob|born\s*(?:on)?)\s*:?\s*\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/i },
  // IPv4 address
  { name: "ip_address", pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/ },
  // US Passport number (keyword + 9 digits)
  { name: "passport", pattern: /(?:passport\s*(?:number|no|#)?\s*:?\s*)\d{9}\b/i },
  // US Driver's License (keyword + state format)
  { name: "drivers_license", pattern: /(?:driver'?s?\s*(?:license|licence)\s*(?:number|no|#)?\s*:?\s*)[A-Z]?\d{4,12}\b/i },
];

export function detectPII(text: string, options?: PIIDetectorOptions): boolean {
  if (!text) return false;

  const normalized = normalizeText(text);

  for (const { pattern } of PII_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  if (options?.blocklist) {
    const lower = normalized.toLowerCase();
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

  const normalized = normalizeText(text);
  const found: string[] = [];

  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(normalized)) found.push(name);
  }

  if (options?.blocklist) {
    const lower = normalized.toLowerCase();
    for (const keyword of options.blocklist) {
      if (lower.includes(keyword.toLowerCase())) {
        found.push("blocklist");
        break;
      }
    }
  }

  return found;
}
