import type { DiscoveredPlugin } from "./registry.js";

export type PluginRuntimeStatus =
  | "discovered"
  | "selected"
  | "built"
  | "watching"
  | "failed";

export interface PluginRuntimeDiagnostic {
  id: string;
  status: PluginRuntimeStatus;
  error?: string;
}

export function resolveSelectedPlugins(
  selectedPluginIds: readonly string[],
  discoveredPlugins: readonly DiscoveredPlugin[],
): {
  selectedPlugins: DiscoveredPlugin[];
  diagnostics: PluginRuntimeDiagnostic[];
} {
  const byId = new Map(discoveredPlugins.map((plugin) => [plugin.id, plugin]));
  const diagnostics: PluginRuntimeDiagnostic[] = [];
  const selectedPlugins: DiscoveredPlugin[] = [];

  for (const pluginId of selectedPluginIds) {
    const plugin = byId.get(pluginId);
    if (!plugin) {
      diagnostics.push({
        id: pluginId,
        status: "failed",
        error: `No discovered source plugin found for "${pluginId}"`,
      });
      continue;
    }

    selectedPlugins.push(plugin);
    diagnostics.push({
      id: pluginId,
      status: "selected",
    });
  }

  return { selectedPlugins, diagnostics };
}

export function formatPluginRuntimeDiagnostics(
  diagnostics: readonly PluginRuntimeDiagnostic[],
): string {
  return diagnostics
    .map((d) => {
      if (d.error) return `${d.id}: ${d.status} (${d.error})`;
      return `${d.id}: ${d.status}`;
    })
    .join("; ");
}

