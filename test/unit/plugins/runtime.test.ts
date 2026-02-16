import { describe, expect, it } from "vitest";
import {
  formatPluginRuntimeDiagnostics,
  resolveSelectedPlugins,
} from "../../../src/plugins/runtime.js";
import type { DiscoveredPlugin } from "../../../src/plugins/registry.js";

const discovered: DiscoveredPlugin[] = [
  {
    id: "plugin-a",
    sourceDir: "/tmp/plugin-a",
    sourceEntryPath: "/tmp/plugin-a/index.ts",
    manifestPath: "/tmp/plugin-a/openclaw.plugin.json",
    manifest: {
      id: "plugin-a",
      version: "1.0.0",
      engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
      capabilities: ["testing"],
      permissions: ["hooks:message_sent"],
      configSchema: { type: "object" },
    },
  },
];

describe("plugin runtime selection", () => {
  it("returns selected plugin diagnostics", () => {
    const result = resolveSelectedPlugins(["plugin-a"], discovered);
    expect(result.selectedPlugins).toHaveLength(1);
    expect(result.selectedPlugins[0].id).toBe("plugin-a");
    expect(result.diagnostics).toEqual([{ id: "plugin-a", status: "selected" }]);
  });

  it("marks missing plugins as failed diagnostics", () => {
    const result = resolveSelectedPlugins(["plugin-missing"], discovered);
    expect(result.selectedPlugins).toEqual([]);
    expect(result.diagnostics[0].status).toBe("failed");
    expect(result.diagnostics[0].error).toContain("plugin-missing");
  });

  it("formats diagnostics for error messages", () => {
    const formatted = formatPluginRuntimeDiagnostics([
      { id: "plugin-a", status: "selected" },
      { id: "plugin-missing", status: "failed", error: "not found" },
    ]);

    expect(formatted).toContain("plugin-a: selected");
    expect(formatted).toContain("plugin-missing: failed");
    expect(formatted).toContain("not found");
  });
});

