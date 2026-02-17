import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../../../src/config/parse.js";
import { generateOpenClawConfig } from "../../../src/config/generate-openclaw.js";
import { resolveAgentRuntime } from "../../../src/config/types.js";
import { getAgentRuntimeAdapter, getAgentRuntimeIds } from "../../../src/config/agent-runtime/registry.js";
import { join } from "node:path";

const fixturesDir = join(import.meta.dirname, "../../fixtures");

describe("agent runtime adapter registry", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns openclaw as the only registered runtime for now", () => {
    expect(getAgentRuntimeIds()).toEqual(["openclaw"]);
  });

  it("uses openclaw adapter by default when deployment is omitted", () => {
    const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
    const runtime = resolveAgentRuntime(config);
    const adapter = getAgentRuntimeAdapter(runtime);
    const outputs = adapter.generate(config);

    expect(outputs).toHaveLength(1);
    expect(outputs[0].filename).toBe("openclaw.json");
  });

  it("keeps openclaw adapter output identical to direct generator output", () => {
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    const adapter = getAgentRuntimeAdapter(resolveAgentRuntime(config));
    const outputs = adapter.generate(config);
    const openclawOutput = outputs.find((entry) => entry.filename === "openclaw.json");

    expect(openclawOutput).toBeDefined();
    const actual = openclawOutput?.content as unknown as Record<string, unknown>;
    const expected = generateOpenClawConfig(config) as unknown as Record<string, unknown>;

    const actualHooks = actual.hooks as Record<string, unknown> | undefined;
    const expectedHooks = expected.hooks as Record<string, unknown> | undefined;
    if (actualHooks && expectedHooks) {
      // Hook token is generated randomly per config build.
      delete actualHooks.token;
      delete expectedHooks.token;
    }

    expect(actual).toEqual(expected);
  });
});
