import { describe, it, expect } from "vitest";
import { parseJsonl } from "../../../src/shared/jsonl.js";

describe("parseJsonl", () => {
  it("should parse valid JSONL content", () => {
    const content = '{"a":1}\n{"a":2}\n{"a":3}';
    const result = parseJsonl<{ a: number }>(content);
    expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("should return empty array for empty string", () => {
    expect(parseJsonl("")).toEqual([]);
  });

  it("should return empty array for whitespace-only string", () => {
    expect(parseJsonl("   \n  \n  ")).toEqual([]);
  });

  it("should skip blank lines", () => {
    const content = '{"a":1}\n\n{"a":2}\n\n';
    const result = parseJsonl<{ a: number }>(content);
    expect(result).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("should skip malformed lines without throwing", () => {
    const content = '{"a":1}\nnot json\n{"a":3}';
    const result = parseJsonl<{ a: number }>(content);
    expect(result).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("should handle single entry", () => {
    const result = parseJsonl('{"key":"value"}');
    expect(result).toEqual([{ key: "value" }]);
  });
});
