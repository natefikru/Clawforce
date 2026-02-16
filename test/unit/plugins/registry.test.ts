import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverPlugins } from "../../../src/plugins/registry.js";

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writePlugin(root: string, dirName: string, pluginId: string): void {
  const pluginDir = join(root, dirName);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "index.ts"), "export function activate() {}", "utf8");
  writeFileSync(
    join(pluginDir, "openclaw.plugin.json"),
    JSON.stringify({
      id: pluginId,
      version: "1.0.0",
      engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
      capabilities: ["testing"],
        permissions: ["hooks:message_sent"],
      configSchema: { type: "object" },
    }),
    "utf8",
  );
}

describe("plugin registry discovery", () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers plugin manifests and sorts by manifest id", () => {
    const pluginsRoot = makeTempDir("clawforce-registry-");
    writePlugin(pluginsRoot, "plugin-b", "b-plugin");
    writePlugin(pluginsRoot, "plugin-a", "a-plugin");

    const discovered = discoverPlugins({ pluginsRootDir: pluginsRoot });
    expect(discovered.map((plugin) => plugin.id)).toEqual(["a-plugin", "b-plugin"]);
  });

  it("throws on duplicate plugin ids", () => {
    const pluginsRoot = makeTempDir("clawforce-registry-dupe-");
    writePlugin(pluginsRoot, "plugin-one", "duplicate");
    writePlugin(pluginsRoot, "plugin-two", "duplicate");

    expect(() => discoverPlugins({ pluginsRootDir: pluginsRoot })).toThrow(
      "Duplicate plugin id detected",
    );
  });

  it("throws when required manifest fields are missing", () => {
    const pluginsRoot = makeTempDir("clawforce-registry-invalid-");
    const pluginDir = join(pluginsRoot, "invalid-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(
      join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "invalid-plugin",
        configSchema: { type: "object" },
      }),
      "utf8",
    );

    expect(() => discoverPlugins({ pluginsRootDir: pluginsRoot })).toThrow(
      "Invalid plugin manifest",
    );
  });

  it("throws when permissions are not namespaced", () => {
    const pluginsRoot = makeTempDir("clawforce-registry-permission-");
    const pluginDir = join(pluginsRoot, "permission-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(
      join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "permission-plugin",
        version: "1.0.0",
        engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
        capabilities: ["testing"],
        permissions: ["invalidPermissionFormat"],
        configSchema: { type: "object" },
      }),
      "utf8",
    );

    expect(() => discoverPlugins({ pluginsRootDir: pluginsRoot })).toThrow(
      "Invalid plugin manifest",
    );
  });

  it("throws when permissions are not allowlisted by security policy", () => {
    const pluginsRoot = makeTempDir("clawforce-registry-policy-");
    const pluginDir = join(pluginsRoot, "policy-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), "export function activate() {}", "utf8");
    writeFileSync(
      join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "policy-plugin",
        version: "1.0.0",
        engines: { clawforce: ">=0.1.0", openclaw: ">=0.1.0" },
        capabilities: ["testing"],
        permissions: ["hooks:dangerous_internal_call"],
        configSchema: { type: "object" },
      }),
      "utf8",
    );

    expect(() => discoverPlugins({ pluginsRootDir: pluginsRoot })).toThrow(
      'declares unsupported permission "hooks:dangerous_internal_call"',
    );
  });
});

