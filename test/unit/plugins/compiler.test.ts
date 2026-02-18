import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPluginsToExtensions,
  watchPluginsToExtensions,
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
    agents: [{ name: "test-agent", workspace: "./workspaces/test-agent", runtime: "openclaw" }],
    openclaw: {
      default: {
        channels: {
          discord: { enabled: true },
        },
      },
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

  it("empty selectedPlugins array returns immediately without creating dir", () => {
    const outDir = join(tmpdir(), "clawforce-empty-build-" + Date.now());
    buildPluginsToExtensions([], outDir);
    expect(existsSync(outDir)).toBe(false);
  });

  it("missing plugin throws with diagnostic message", () => {
    const outDir = makeTempDir("clawforce-missing-build-");
    expect(() =>
      buildPluginsToExtensions(["nonexistent-plugin"], outDir),
    ).toThrow("Plugin selection failed");
  });

  it("clean=false preserves existing files in extensions dir", () => {
    const outDir = makeTempDir("clawforce-noclean-build-");
    const markerDir = join(outDir, "clawforce-router");
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, "marker.txt"), "keep", "utf8");

    buildPluginsToExtensions(["clawforce-router"], outDir, { clean: false });

    // marker file should still exist since clean=false
    expect(existsSync(join(markerDir, "marker.txt"))).toBe(true);
    // Build artifacts should also exist
    expect(existsSync(join(markerDir, "index.js"))).toBe(true);
  });

  it("clean=true (default) removes existing plugin dir before build", () => {
    const outDir = makeTempDir("clawforce-clean-build-");
    const markerDir = join(outDir, "clawforce-router");
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, "marker.txt"), "keep", "utf8");

    buildPluginsToExtensions(["clawforce-router"], outDir);

    // marker file should be gone since default is clean=true
    expect(existsSync(join(markerDir, "marker.txt"))).toBe(false);
    expect(existsSync(join(markerDir, "index.js"))).toBe(true);
  });

  describe("watchPluginsToExtensions", () => {
    it("empty selectedPlugins array throws", async () => {
      const outDir = makeTempDir("clawforce-watch-empty-");
      await expect(
        watchPluginsToExtensions([], outDir),
      ).rejects.toThrow("No plugins selected for watch mode");
    });

    it("missing plugin throws with diagnostic message", async () => {
      const outDir = makeTempDir("clawforce-watch-missing-");
      await expect(
        watchPluginsToExtensions(["nonexistent-plugin"], outDir),
      ).rejects.toThrow("Plugin selection failed");
    });

    it("starts watch mode and close() disposes contexts", async () => {
      const outDir = makeTempDir("clawforce-watch-");
      const handle = await watchPluginsToExtensions(["clawforce-router"], outDir);

      // Verify built
      const pluginDir = join(outDir, "clawforce-router");
      expect(existsSync(join(pluginDir, "index.js"))).toBe(true);
      expect(existsSync(join(pluginDir, "openclaw.plugin.json"))).toBe(true);

      // Close should not throw
      await expect(handle.close()).resolves.toBeUndefined();
    });
  });

  it("excludes core plugins when their toggles are disabled", () => {
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
        compliance: { enabled: false },
      }),
      { pluginsRootDir },
    );
    expect(selected).toEqual([]);
  });

  it("uses plugins.enabled allow-list when provided", () => {
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
        plugins: {
          enabled: ["clawforce-compliance"],
        },
      }),
      { pluginsRootDir },
    );
    expect(selected).toEqual(["clawforce-compliance"]);
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
        routing: {},
      }),
      { pluginsRootDir },
    );

    expect(selected).toEqual(["acme-tooling"]);
  });
});
