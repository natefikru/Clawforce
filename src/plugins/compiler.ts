import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSync,
  context,
  formatMessages,
  type BuildFailure,
  type BuildContext,
  type BuildOptions,
} from "esbuild";
import type { ClawforceConfig } from "../config/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginsRootDir = resolve(join(__dirname, "..", "plugins"));

export const pluginNames = ["clawforce-router", "clawforce-compliance"] as const;
export type PluginName = (typeof pluginNames)[number];

interface CompileOptions {
  clean?: boolean;
}

export interface PluginWatchHandle {
  close: () => Promise<void>;
}

function sourceEntryForPlugin(pluginName: PluginName): string {
  return join(pluginsRootDir, pluginName, "index.ts");
}

function manifestSourceForPlugin(pluginName: PluginName): string {
  return join(pluginsRootDir, pluginName, "openclaw.plugin.json");
}

function manifestOutputForPlugin(pluginName: PluginName, extensionsDir: string): string {
  return join(extensionsDir, pluginName, "openclaw.plugin.json");
}

function bundlerOptionsFor(
  pluginName: PluginName,
  extensionsDir: string,
): BuildOptions {
  return {
    entryPoints: [sourceEntryForPlugin(pluginName)],
    outfile: join(extensionsDir, pluginName, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    logLevel: "silent",
  };
}

async function formatBuildFailure(error: BuildFailure): Promise<string> {
  const messages = await formatMessages(error.errors, {
    kind: "error",
    color: false,
  });
  return messages.join("\n");
}

export function enabledPluginsForConfig(config: ClawforceConfig): PluginName[] {
  const selected: PluginName[] = [];
  if (config.router?.enabled !== false && config.router) {
    selected.push("clawforce-router");
  }
  if (config.compliance?.enabled !== false && config.compliance) {
    selected.push("clawforce-compliance");
  }
  return selected;
}

function formatBuildFailureSync(error: BuildFailure): string {
  return error.errors
    .map((item) => {
      const line = item.location
        ? `${item.location.file}:${item.location.line}:${item.location.column}`
        : "unknown";
      return `${line} ${item.text}`;
    })
    .join("\n");
}

export function buildPluginsToExtensions(
  selectedPlugins: readonly PluginName[],
  extensionsDir: string,
  options: CompileOptions = {},
): void {
  if (selectedPlugins.length === 0) return;

  mkdirSync(extensionsDir, { recursive: true });
  if (options.clean !== false) {
    for (const pluginName of selectedPlugins) {
      const pluginDir = join(extensionsDir, pluginName);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }
    }
  }

  try {
    for (const pluginName of selectedPlugins) {
      buildSync(bundlerOptionsFor(pluginName, extensionsDir));
      cpSync(
        manifestSourceForPlugin(pluginName),
        manifestOutputForPlugin(pluginName, extensionsDir),
      );
    }
  } catch (error) {
    if (error && typeof error === "object" && "errors" in error) {
      const message = formatBuildFailureSync(error as BuildFailure);
      throw new Error(`Plugin bundle failed:\n${message}`);
    }
    throw error;
  }
}

export async function watchPluginsToExtensions(
  selectedPlugins: readonly PluginName[],
  extensionsDir: string,
): Promise<PluginWatchHandle> {
  if (selectedPlugins.length === 0) {
    throw new Error("No plugins selected for watch mode.");
  }

  mkdirSync(extensionsDir, { recursive: true });
  const contexts: BuildContext<BuildOptions>[] = [];

  try {
    for (const pluginName of selectedPlugins) {
      const ctx = await context(bundlerOptionsFor(pluginName, extensionsDir));
      contexts.push(ctx);
      await ctx.rebuild();
      cpSync(
        manifestSourceForPlugin(pluginName),
        manifestOutputForPlugin(pluginName, extensionsDir),
      );
      await ctx.watch();
    }

    return {
      close: async () => {
        await Promise.all(contexts.map((ctx) => ctx.dispose()));
      },
    };
  } catch (error) {
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    if (error && typeof error === "object" && "errors" in error) {
      const message = await formatBuildFailure(error as BuildFailure);
      throw new Error(`Plugin watch failed:\n${message}`);
    }
    throw error;
  }
}
