import { mkdirSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ClawforceConfig } from "../config/types.js";
import { generateAgentsMd } from "./agents-md.js";
import {
  buildPluginsToExtensions,
  enabledPluginsForConfig,
} from "../plugins/compiler.js";

export function setupWorkspace(config: ClawforceConfig, deployDir: string): void {
  const workspaceDir = join(deployDir, "workspace");
  const configDir = join(deployDir, "config");
  const dataDir = join(deployDir, "data");

  // Create directory structure
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(dataDir, "cron"), { recursive: true });

  // Generate AGENTS.md
  const agentsMd = generateAgentsMd(config);
  writeFileSync(join(workspaceDir, "AGENTS.md"), agentsMd, "utf8");

  // Create empty audit log
  const auditPath = join(dataDir, "audit.jsonl");
  if (!existsSync(auditPath)) {
    writeFileSync(auditPath, "", "utf8");
  }

  // Build plugins to extensions directory for OpenClaw auto-discovery.
  const extensionsDir = join(configDir, "extensions");
  const enabledPlugins = enabledPluginsForConfig(config);
  buildPluginsToExtensions(enabledPlugins, extensionsDir);

  // Persist auth-profile metadata for auth_profile credential mode.
  if (config.auth_profile) {
    writeFileSync(
      join(configDir, "auth-profile.json"),
      `${JSON.stringify(
        {
          mode: "auth_profile",
          profile: config.auth_profile,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}
