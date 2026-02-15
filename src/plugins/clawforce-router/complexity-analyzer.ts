/**
 * Heuristic-based prompt complexity analysis for model routing.
 * Analyzes word count, code blocks, multi-step markers, and
 * structural indicators to classify prompts as low/medium/high.
 */

export type ComplexityLevel = "low" | "medium" | "high";

const MULTI_STEP_MARKERS = [
  /\bfirst\b.*\bthen\b/is,
  /\bstep\s*\d/i,
  /\b\d+\)\s/,
  /\bfinally\b/i,
  /\bafter\s+that\b/i,
  /\bnext\b.*\bthen\b/is,
];

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

const HIGH_COMPLEXITY_KEYWORDS = [
  "refactor",
  "architect",
  "implement",
  "debug",
  "analyze",
  "optimize",
  "design",
  "compare",
  "evaluate",
  "integrate",
];

interface ComplexityFactors {
  wordCount: number;
  hasCodeBlocks: boolean;
  hasMultiStepMarkers: boolean;
  highComplexityKeywordCount: number;
  questionCount: number;
}

export function analyzeComplexity(text: string): ComplexityLevel {
  const factors = extractFactors(text);
  return scoreFactors(factors);
}

export function extractFactors(text: string): ComplexityFactors {
  if (!text) {
    return {
      wordCount: 0,
      hasCodeBlocks: false,
      hasMultiStepMarkers: false,
      highComplexityKeywordCount: 0,
      questionCount: 0,
    };
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const hasCodeBlocks =
    CODE_BLOCK_PATTERN.test(text) || INLINE_CODE_PATTERN.test(text);
  const hasMultiStepMarkers = MULTI_STEP_MARKERS.some((p) => p.test(text));

  const lower = text.toLowerCase();
  const highComplexityKeywordCount = HIGH_COMPLEXITY_KEYWORDS.filter((kw) =>
    lower.includes(kw),
  ).length;

  const questionCount = (text.match(/\?/g) ?? []).length;

  return {
    wordCount: words.length,
    hasCodeBlocks,
    hasMultiStepMarkers,
    highComplexityKeywordCount,
    questionCount,
  };
}

function scoreFactors(factors: ComplexityFactors): ComplexityLevel {
  let score = 0;

  // Word count scoring
  if (factors.wordCount > 100) score += 3;
  else if (factors.wordCount > 50) score += 2;
  else if (factors.wordCount > 20) score += 1;

  // Code blocks are a strong complexity signal
  if (factors.hasCodeBlocks) score += 2;

  // Multi-step instructions
  if (factors.hasMultiStepMarkers) score += 2;

  // High-complexity keywords
  if (factors.highComplexityKeywordCount >= 3) score += 2;
  else if (factors.highComplexityKeywordCount >= 1) score += 1;

  // Multiple questions
  if (factors.questionCount >= 3) score += 1;

  if (score >= 5) return "high";
  if (score >= 2) return "medium";
  return "low";
}
