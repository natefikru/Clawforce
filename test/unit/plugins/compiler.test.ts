import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPluginsToExtensions,
  enabledPluginsForConfig,
} from "../../../src/plugins/compiler.js";
import type { ClawforceConfig } from "../../../src/config/types.js";

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function makeConfig(overrides: Partial<ClawforceConfig> = {}): ClawforceConfig {
  return {
    name: "test-corp",
    role: "inbox-analyst",
    openclaw: {
      channels: {
        discord: { enabled: true },
      },
    },
    models: {
      primary: "anthropic/claude-sonnet-4-5",
    },
    ...overrides,
  };
}

describe("plugin compiler", () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bundles router plugin to javascript with sourcemap", () => {
    const outDir = makeTempDir("clawforce-plugin-build-");
    buildPluginsToExtensions(["clawforce-router"], outDir);

    const pluginDir = join(outDir, "clawforce-router");
    expect(existsSync(join(pluginDir, "index.js"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.js.map"))).toBe(true);
    expect(existsSync(join(pluginDir, "openclaw.plugin.json"))).toBe(true);
    expect(existsSync(join(pluginDir, "index.ts"))).toBe(false);
  });

  it("selects all discovered plugins regardless of legacy plugin toggles", () => {
    const pluginsRootDir = makeTempDir("clawforce-plugins-root-");
    const routerDir = join(pluginsRootDir, "router");
    const complianceDir = join(pluginsRootDir, "compliance");
    mkdirSync(routerDir, { recursive: true });
    mkdirSync(complianceDir, { recursive: true });
    writeFileSync(join(routerDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(join(complianceDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(
      join(routerDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "clawforce-router",
        version: "1.0.0",
        engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
        capabilities: ["routing"],
        permissions: ["hooks:before_agent_start"],
        configSchema: { type: "object" },
      }),
      "utf8",
    );
    writeFileSync(
      join(complianceDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "clawforce-compliance",
        version: "1.0.0",
        engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
        capabilities: ["compliance"],
        permissions: ["hooks:message_sent"],
        configSchema: { type: "object" },
      }),
      "utf8",
    );

    const selected = enabledPluginsForConfig(
      makeConfig({
        router: { enabled: false },
        compliance: { enabled: false },
      }),
      { pluginsRootDir },
    );
    expect(selected).toEqual(["clawforce-compliance", "clawforce-router"]);
  });

  it("includes discovered non-core plugins automatically", () => {
    const pluginsRootDir = makeTempDir("clawforce-plugins-root-");
    const pluginDir = join(pluginsRootDir, "acme-tooling");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(
      join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "acme-tooling",
        version: "1.0.0",
        engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
        capabilities: ["tooling"],
        permissions: ["hooks:message_sent"],
        configSchema: { type: "object" },
      }),
      "utf8",
    );

    const selected = enabledPluginsForConfig(
      makeConfig({
        router: { enabled: true },
      }),
      { pluginsRootDir },
    );

    expect(selected).toEqual(["acme-tooling"]);
  });
});
