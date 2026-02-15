/**
 * Shared JSONL parsing utility.
 * Used by the compliance plugin and audit command.
 */

export function parseJsonl<T = Record<string, unknown>>(content: string): T[] {
  if (!content.trim()) return [];
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is T => entry !== null);
}
