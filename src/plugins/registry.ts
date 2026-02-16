import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenClawPluginManifestSchema,
  type OpenClawPluginManifest,
} from "./manifest-schema.js";
import { enforcePluginSecurityPolicy } from "./security-policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginsRootDir = resolve(join(__dirname, "..", "plugins"));

export interface DiscoveredPlugin {
  id: string;
  sourceDir: string;
  sourceEntryPath: string;
  manifestPath: string;
  manifest: OpenClawPluginManifest;
}

export interface DiscoverPluginsOptions {
  pluginsRootDir?: string;
}

function readManifest(manifestPath: string): OpenClawPluginManifest {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read plugin manifest at ${manifestPath}: ${String(error)}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON plugin manifest at ${manifestPath}: ${String(error)}`);
  }

  const parsed = OpenClawPluginManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid plugin manifest at ${manifestPath}: ${issues}`);
  }

  enforcePluginSecurityPolicy(parsed.data);
  return parsed.data;
}

export function discoverPlugins(options: DiscoverPluginsOptions = {}): DiscoveredPlugin[] {
  const pluginsRootDir = options.pluginsRootDir
    ? resolve(options.pluginsRootDir)
    : defaultPluginsRootDir;
  const entries = readdirSync(pluginsRootDir, { withFileTypes: true });
  const discovered: DiscoveredPlugin[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(pluginsRootDir, entry.name);
    const sourceEntryPath = join(sourceDir, "index.ts");
    const manifestPath = join(sourceDir, "openclaw.plugin.json");

    if (!existsSync(sourceEntryPath) || !existsSync(manifestPath)) continue;

    const manifest = readManifest(manifestPath);
    const id = manifest.id;
    if (seenIds.has(id)) {
      throw new Error(`Duplicate plugin id detected: ${id}`);
    }

    seenIds.add(id);
    discovered.push({
      id,
      sourceDir,
      sourceEntryPath,
      manifestPath,
      manifest,
    });
  }

  discovered.sort((a, b) => a.id.localeCompare(b.id));
  return discovered;
}

