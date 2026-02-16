import { dirname, join, resolve } from "node:path";
import { parseConfig } from "../config/parse.js";
import {
  buildPluginsToExtensions,
  enabledPluginsForConfig,
  watchPluginsToExtensions,
} from "../plugins/compiler.js";
import { logger } from "../utils/logger.js";

interface PluginCommandOptions {
  config: string;
  extensionsDir?: string;
  router?: boolean;
  compliance?: boolean;
}

function selectedPluginsFromOptions(
  enabledByConfig: string[],
  options: PluginCommandOptions,
): string[] {
  if (!options.router && !options.compliance) {
    return enabledByConfig;
  }

  const requested = new Set<string>();
  if (options.router) requested.add("clawforce-router");
  if (options.compliance) requested.add("clawforce-compliance");
  return enabledByConfig.filter((pluginName) => requested.has(pluginName));
}

function resolveExtensionsDir(
  options: PluginCommandOptions,
  configName: string,
): string {
  if (options.extensionsDir) {
    return resolve(options.extensionsDir);
  }

  const configPath = resolve(options.config);
  const configBaseDir = dirname(configPath);
  return resolve(
    join(configBaseDir, `clawforce-${configName}`, "config", "extensions"),
  );
}

function selectPluginsOrThrow(options: PluginCommandOptions): {
  configName: string;
  extensionsDir: string;
  selectedPlugins: string[];
} {
  const config = parseConfig(options.config);
  const enabledPlugins = enabledPluginsForConfig(config);
  const selectedPlugins = selectedPluginsFromOptions(enabledPlugins, options);

  if (selectedPlugins.length === 0) {
    throw new Error(
      "No discovered plugins selected. Add plugins to src/plugins or pass matching flags.",
    );
  }

  return {
    configName: config.name,
    extensionsDir: resolveExtensionsDir(options, config.name),
    selectedPlugins,
  };
}

export async function pluginsBundleCommand(
  options: PluginCommandOptions,
): Promise<void> {
  const { extensionsDir, selectedPlugins } = selectPluginsOrThrow(options);
  logger.header("Plugin Bundle");
  logger.step(`Bundling plugins: ${selectedPlugins.join(", ")}`);
  logger.info(`Extensions output: ${extensionsDir}`);

  buildPluginsToExtensions(selectedPlugins, extensionsDir);
  logger.success("Plugin bundle complete.");
}

export async function pluginsWatchCommand(
  options: PluginCommandOptions,
): Promise<void> {
  const { extensionsDir, selectedPlugins } = selectPluginsOrThrow(options);

  logger.header("Plugin Watch");
  logger.step(`Watching plugins: ${selectedPlugins.join(", ")}`);
  logger.info(`Extensions output: ${extensionsDir}`);

  const watcher = await watchPluginsToExtensions(selectedPlugins, extensionsDir);
  logger.success("Initial bundle complete. Watching for plugin changes...");
  logger.info("Press Ctrl+C to stop.");

  await new Promise<void>((resolvePromise) => {
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await watcher.close();
      resolvePromise();
    };

    const onSignal = () => {
      void close();
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
