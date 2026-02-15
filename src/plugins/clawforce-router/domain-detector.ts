/**
 * Keyword-based prompt domain classification for model routing.
 * Classifies prompts into task domains (code, writing, analysis, data, conversation)
 * to enable domain-specialized model routing.
 */

export type TaskDomain = "code" | "writing" | "analysis" | "conversation" | "data";

export interface DomainSignals {
  domain: TaskDomain;
  confidence: number;
  matchedIndicators: string[];
}

const DOMAIN_INDICATORS: Record<Exclude<TaskDomain, "conversation">, string[]> = {
  code: [
    "function", "class", "import", "const", "var", "let", "def", "return",
    "error", "bug", "fix", "compile", "debug", "refactor", "commit",
    "```", ".ts", ".py", ".js", ".go", ".rs", ".java", ".cpp",
    "git", "npm", "docker", "api", "endpoint", "middleware", "async",
    "await", "promise", "callback", "interface", "type", "enum",
    "array", "object", "string", "boolean", "null", "undefined",
    "try", "catch", "throw", "if", "else", "for", "while", "switch",
  ],
  writing: [
    "write", "draft", "edit", "tone", "summarize", "blog", "email",
    "letter", "essay", "proofread", "rewrite", "paragraph", "article",
    "copywriting", "headline", "tagline", "slogan", "narrative",
    "storytelling", "creative", "prose", "grammar", "style",
  ],
  analysis: [
    "analyze", "compare", "evaluate", "trend", "metric", "percentage",
    "growth", "decline", "benchmark", "report", "insight", "correlation",
    "forecast", "predict", "assess", "review", "performance", "impact",
    "strategy", "recommendation", "tradeoff", "pros and cons",
  ],
  data: [
    "extract", "parse", "csv", "json", "sql", "table", "column", "row",
    "dataset", "transform", "filter", "aggregate", "query", "database",
    "schema", "migration", "etl", "pipeline", "scrape", "regex",
    "spreadsheet", "excel", "worksheet",
  ],
};

const CONVERSATION_MAX_WORDS = 15;
const MIN_MATCH_COUNT = 2;

export function detectDomain(text: string): DomainSignals {
  if (!text || !text.trim()) {
    return { domain: "conversation", confidence: 1, matchedIndicators: [] };
  }

  const lower = text.toLowerCase();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  const scores: Array<{ domain: Exclude<TaskDomain, "conversation">; matchCount: number; matched: string[] }> = [];

  for (const [domain, indicators] of Object.entries(DOMAIN_INDICATORS) as Array<[Exclude<TaskDomain, "conversation">, string[]]>) {
    const matched: string[] = [];
    for (const indicator of indicators) {
      if (lower.includes(indicator)) {
        matched.push(indicator);
      }
    }
    scores.push({ domain, matchCount: matched.length, matched });
  }

  // Sort by match count (most matches first)
  scores.sort((a, b) => b.matchCount - a.matchCount);

  const best = scores[0];

  // Short text with insufficient domain signals → conversation
  if (wordCount <= CONVERSATION_MAX_WORDS && best.matchCount < MIN_MATCH_COUNT) {
    return { domain: "conversation", confidence: 1, matchedIndicators: [] };
  }

  // No domain has enough matches → conversation
  if (best.matchCount < MIN_MATCH_COUNT) {
    return { domain: "conversation", confidence: 1, matchedIndicators: [] };
  }

  // Confidence: ratio of matched indicators to total for that domain
  const totalIndicators = DOMAIN_INDICATORS[best.domain].length;
  const confidence = Math.round((best.matchCount / totalIndicators) * 100) / 100;

  return {
    domain: best.domain,
    confidence,
    matchedIndicators: best.matched,
  };
}
