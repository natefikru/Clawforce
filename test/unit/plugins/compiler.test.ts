import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
    slack: {
      app_token: "xapp-1-TEST",
      bot_token: "xoxb-TEST",
      approval_channel: "C0123456789",
      allowed_channels: ["C9876543210"],
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
    expect(existsSync(join(pluginDir, "index.ts"))).toBe(false);
  });

  it("returns plugins enabled by config", () => {
    const bothEnabled = enabledPluginsForConfig(
      makeConfig({
        router: { enabled: true },
        compliance: { enabled: true },
      }),
    );
    expect(bothEnabled).toEqual(["clawforce-router", "clawforce-compliance"]);

    const onlyRouter = enabledPluginsForConfig(
      makeConfig({
        router: { enabled: true },
      }),
    );
    expect(onlyRouter).toEqual(["clawforce-router"]);
  });
});
