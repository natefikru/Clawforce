import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { expandEnvVars } from "../../../src/utils/env-vars.js";

describe("expandEnvVars", () => {
  beforeEach(() => {
    process.env.TEST_VAR = "hello";
    process.env.ANOTHER_VAR = "world";
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
    delete process.env.ANOTHER_VAR;
  });

  it("should expand a single env var in a string", () => {
    expect(expandEnvVars("${TEST_VAR}")).toBe("hello");
  });

  it("should expand multiple env vars in a string", () => {
    expect(expandEnvVars("${TEST_VAR} ${ANOTHER_VAR}")).toBe("hello world");
  });

  it("should expand env vars in nested objects", () => {
    const input = { a: { b: "${TEST_VAR}" } };
    expect(expandEnvVars(input)).toEqual({ a: { b: "hello" } });
  });

  it("should expand env vars in arrays", () => {
    const input = ["${TEST_VAR}", "${ANOTHER_VAR}"];
    expect(expandEnvVars(input)).toEqual(["hello", "world"]);
  });

  it("should pass through non-string primitives", () => {
    expect(expandEnvVars(42)).toBe(42);
    expect(expandEnvVars(true)).toBe(true);
    expect(expandEnvVars(null)).toBe(null);
  });

  it("should throw on missing env var", () => {
    expect(() => expandEnvVars("${MISSING_VAR}")).toThrow(
      "Environment variable MISSING_VAR is not set",
    );
  });

  it("should throw on empty env var", () => {
    process.env.EMPTY_VAR = "";
    expect(() => expandEnvVars("${EMPTY_VAR}")).toThrow(
      "Environment variable EMPTY_VAR is not set",
    );
    delete process.env.EMPTY_VAR;
  });

  it("should handle escaped env vars", () => {
    expect(expandEnvVars("$${TEST_VAR}")).toBe("${TEST_VAR}");
  });

  it("should leave strings without env vars unchanged", () => {
    expect(expandEnvVars("no vars here")).toBe("no vars here");
  });
});
