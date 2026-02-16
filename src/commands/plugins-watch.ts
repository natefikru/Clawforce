import { join, resolve } from "node:path";
import { parseConfig } from "../config/parse.js";
import {
  enabledPluginsForConfig,
  watchPluginsToExtensions,
  type PluginName,
} from "../plugins/compiler.js";
import { logger } from "../utils/logger.js";

interface PluginsWatchOptions {
  config: string;
  extensionsDir?: string;
  router?: boolean;
  compliance?: boolean;
}

function selectedPluginsFromOptions(
  enabledByConfig: PluginName[],
  options: PluginsWatchOptions,
): PluginName[] {
  if (!options.router && !options.compliance) {
    return enabledByConfig;
  }

  const requested = new Set<PluginName>();
  if (options.router) requested.add("clawforce-router");
  if (options.compliance) requested.add("clawforce-compliance");
  return enabledByConfig.filter((pluginName) => requested.has(pluginName));
}

export async function pluginsWatchCommand(
  options: PluginsWatchOptions,
): Promise<void> {
  const config = parseConfig(options.config);
  const enabledPlugins = enabledPluginsForConfig(config);
  const selectedPlugins = selectedPluginsFromOptions(enabledPlugins, options);

  if (selectedPlugins.length === 0) {
    throw new Error(
      "No enabled plugins selected. Enable router/compliance in config or pass matching flags.",
    );
  }

  const extensionsDir = options.extensionsDir
    ? resolve(options.extensionsDir)
    : resolve(join(`./clawforce-${config.name}`, "config", "extensions"));

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
