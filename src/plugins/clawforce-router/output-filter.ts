/**
 * Output filtering for model responses and tool results.
 *
 * Scans outbound text for PII using the same detection pipeline as
 * inbound routing and replaces matches with redaction markers like
 * [SSN_REDACTED]. Preserves surrounding text and handles overlapping
 * matches by processing from end to start.
 */

import { scanForPII, type PIIDetectorOptions, type PIIMatch } from "./pii-detector.js";

export interface OutputFilterResult {
  content: string;
  redacted: boolean;
  redactedTypes: string[];
  matchCount: number;
}

/**
 * Scan text for PII and replace matches with redaction markers.
 * Markers follow the pattern `[TYPE_REDACTED]`, e.g. `[SSN_REDACTED]`.
 *
 * Matches are replaced from end to start so that positions remain valid
 * as the string is mutated.
 */
export function filterOutput(
  content: string,
  options?: PIIDetectorOptions,
): OutputFilterResult {
  if (!content) {
    return { content, redacted: false, redactedTypes: [], matchCount: 0 };
  }

  const matches = scanForPII(content, options);
  if (matches.length === 0) {
    return { content, redacted: false, redactedTypes: [], matchCount: 0 };
  }

  // Sort by position descending so replacements don't shift indices
  const sorted = [...matches].sort(
    (a, b) => b.position.start - a.position.start,
  );

  let redacted = content;
  for (const match of sorted) {
    const mask = `[${match.type.toUpperCase()}_REDACTED]`;
    redacted =
      redacted.slice(0, match.position.start) +
      mask +
      redacted.slice(match.position.end);
  }

  return {
    content: redacted,
    redacted: true,
    redactedTypes: [...new Set(matches.map((m) => m.type))],
    matchCount: matches.length,
  };
}
