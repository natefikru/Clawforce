import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildSync,
  context,
  formatMessages,
  type BuildFailure,
  type BuildContext,
  type BuildOptions,
} from "esbuild";
import type { ClawforceConfig } from "../config/types.js";
import {
  discoverPlugins,
  type DiscoveredPlugin,
  type DiscoverPluginsOptions,
} from "./registry.js";
import {
  formatPluginRuntimeDiagnostics,
  resolveSelectedPlugins,
  type PluginRuntimeDiagnostic,
} from "./runtime.js";

interface CompileOptions {
  clean?: boolean;
  pluginsRootDir?: string;
}

export interface PluginWatchHandle {
  close: () => Promise<void>;
}

function manifestOutputForPlugin(pluginId: string, extensionsDir: string): string {
  return join(extensionsDir, pluginId, "openclaw.plugin.json");
}

function bundlerOptionsFor(
  plugin: DiscoveredPlugin,
  extensionsDir: string,
): BuildOptions {
  return {
    entryPoints: [plugin.sourceEntryPath],
    outfile: join(extensionsDir, plugin.id, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    logLevel: "silent",
  };
}

function selectedPluginIdsFromConfig(
  _config: ClawforceConfig,
  discoveredPlugins: readonly DiscoveredPlugin[],
): string[] {
  return discoveredPlugins.map((plugin) => plugin.id);
}

async function formatBuildFailure(error: BuildFailure): Promise<string> {
  const messages = await formatMessages(error.errors, {
    kind: "error",
    color: false,
  });
  return messages.join("\n");
}

export function enabledPluginsForConfig(
  config: ClawforceConfig,
  options: DiscoverPluginsOptions = {},
): string[] {
  const discoveredPlugins = discoverPlugins(options);
  return selectedPluginIdsFromConfig(config, discoveredPlugins);
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
  selectedPlugins: readonly string[],
  extensionsDir: string,
  options: CompileOptions = {},
): void {
  if (selectedPlugins.length === 0) return;
  const discoveredPlugins = discoverPlugins({ pluginsRootDir: options.pluginsRootDir });
  const selection = resolveSelectedPlugins(selectedPlugins, discoveredPlugins);
  const diagnostics: PluginRuntimeDiagnostic[] = [...selection.diagnostics];
  const missing = selection.diagnostics.filter((item) => item.status === "failed");
  if (missing.length > 0) {
    throw new Error(
      `Plugin selection failed: ${formatPluginRuntimeDiagnostics(missing)}`,
    );
  }

  mkdirSync(extensionsDir, { recursive: true });
  if (options.clean !== false) {
    for (const pluginId of selectedPlugins) {
      const pluginDir = join(extensionsDir, pluginId);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }
    }
  }

  try {
    for (const plugin of selection.selectedPlugins) {
      const pluginId = plugin.id;
      buildSync(bundlerOptionsFor(plugin, extensionsDir));
      cpSync(
        plugin.manifestPath,
        manifestOutputForPlugin(pluginId, extensionsDir),
      );
      diagnostics.push({
        id: pluginId,
        status: "built",
      });
    }
  } catch (error) {
    if (error && typeof error === "object" && "errors" in error) {
      const message = formatBuildFailureSync(error as BuildFailure);
      throw new Error(
        `Plugin bundle failed: ${formatPluginRuntimeDiagnostics(diagnostics)}\n${message}`,
      );
    }
    throw error;
  }
}

export async function watchPluginsToExtensions(
  selectedPlugins: readonly string[],
  extensionsDir: string,
  options: CompileOptions = {},
): Promise<PluginWatchHandle> {
  if (selectedPlugins.length === 0) {
    throw new Error("No plugins selected for watch mode.");
  }
  const discoveredPlugins = discoverPlugins({ pluginsRootDir: options.pluginsRootDir });
  const selection = resolveSelectedPlugins(selectedPlugins, discoveredPlugins);
  const diagnostics: PluginRuntimeDiagnostic[] = [...selection.diagnostics];
  const missing = selection.diagnostics.filter((item) => item.status === "failed");
  if (missing.length > 0) {
    throw new Error(
      `Plugin selection failed: ${formatPluginRuntimeDiagnostics(missing)}`,
    );
  }

  mkdirSync(extensionsDir, { recursive: true });
  const contexts: BuildContext<BuildOptions>[] = [];

  try {
    for (const plugin of selection.selectedPlugins) {
      const pluginId = plugin.id;
      const ctx = await context(bundlerOptionsFor(plugin, extensionsDir));
      contexts.push(ctx);
      await ctx.rebuild();
      cpSync(
        plugin.manifestPath,
        manifestOutputForPlugin(pluginId, extensionsDir),
      );
      await ctx.watch();
      diagnostics.push({
        id: pluginId,
        status: "watching",
      });
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
      throw new Error(
        `Plugin watch failed: ${formatPluginRuntimeDiagnostics(diagnostics)}\n${message}`,
      );
    }
    throw error;
  }
}
