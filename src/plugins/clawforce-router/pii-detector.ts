/**
 * Regex-based PII detection for model routing decisions.
 * Scans text for SSN, credit card numbers, emails, phone numbers,
 * and configurable keyword blocklists.
 *
 * Includes adversarial defense: unicode normalization strips zero-width
 * characters, decomposes ligatures, and folds common homoglyphs before
 * pattern matching.
 *
 * The primary API is scanForPII() which returns PIIMatch objects with
 * type, confidence, position, and matchedText. The legacy detectPII()
 * and detectPIITypes() functions are backward-compatible wrappers.
 */

export interface PIIDetectorOptions {
  /** Additional keywords that indicate sensitive content */
  blocklist?: string[];
}

export interface PIIMatch {
  type: string;
  confidence: number;
  position: { start: number; end: number };
  matchedText: string;
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

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; confidence: number }> = [
  // SSN: 123-45-6789 or 123 45 6789 (separators required to avoid false positives on bare 9-digit numbers)
  { name: "ssn", pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/, confidence: 0.95 },
  // Credit card: 16 digits with optional separators (Visa, Mastercard, Discover)
  { name: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/, confidence: 0.95 },
  // Credit card: Amex — starts with 34 or 37, 15 digits
  { name: "credit_card_amex", pattern: /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/, confidence: 0.95 },
  // Email address
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, confidence: 0.85 },
  // US phone: (123) 456-7890, 123-456-7890, +1-123-456-7890
  { name: "phone", pattern: /\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}\b/, confidence: 0.85 },
  // IBAN: 2 letter country code + 2 check digits + 11-30 alphanumeric (minimum 15 chars total)
  { name: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, confidence: 0.90 },
  // Date of birth: keyword + date pattern
  { name: "dob", pattern: /\b(?:date\s*(?:of\s*)?birth|dob|born\s*(?:on)?)\s*:?\s*\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/i, confidence: 0.75 },
  // IPv4 address
  { name: "ip_address", pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/, confidence: 0.75 },
  // US Passport number (keyword + 9 digits)
  { name: "passport", pattern: /(?:passport\s*(?:number|no|#)?\s*:?\s*)\d{9}\b/i, confidence: 0.95 },
  // US Driver's License (keyword + state format)
  { name: "drivers_license", pattern: /(?:driver'?s?\s*(?:license|licence)\s*(?:number|no|#)?\s*:?\s*)[A-Z]?\d{4,12}\b/i, confidence: 0.85 },
];

/**
 * Scan text for PII matches with confidence scoring and positions.
 * This is the primary API — use this for detailed match information.
 */
export function scanForPII(
  text: string,
  options?: PIIDetectorOptions,
): PIIMatch[] {
  if (!text) return [];

  const normalized = normalizeText(text);
  const matches: PIIMatch[] = [];

  for (const { name, pattern, confidence } of PII_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(normalized)) !== null) {
      matches.push({
        type: name,
        confidence,
        position: { start: match.index, end: match.index + match[0].length },
        matchedText: match[0],
      });
    }
  }

  if (options?.blocklist) {
    const lower = normalized.toLowerCase();
    for (const keyword of options.blocklist) {
      const keyLower = keyword.toLowerCase();
      let searchFrom = 0;
      let idx: number;
      while ((idx = lower.indexOf(keyLower, searchFrom)) !== -1) {
        matches.push({
          type: "blocklist",
          confidence: 0.70,
          position: { start: idx, end: idx + keyword.length },
          matchedText: normalized.slice(idx, idx + keyword.length),
        });
        searchFrom = idx + keyword.length;
      }
    }
  }

  return matches;
}

/** Backward-compatible boolean PII check. */
export function detectPII(text: string, options?: PIIDetectorOptions): boolean {
  return scanForPII(text, options).length > 0;
}

/** Backward-compatible PII type list. */
export function detectPIITypes(
  text: string,
  options?: PIIDetectorOptions,
): string[] {
  const matches = scanForPII(text, options);
  return [...new Set(matches.map((m) => m.type))];
}
