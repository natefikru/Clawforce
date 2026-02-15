import { mkdirSync, cpSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawforceConfig } from "../config/types.js";
import { generateAgentsMd } from "./agents-md.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "..", "templates");

export function setupWorkspace(config: ClawforceConfig, deployDir: string): void {
  const workspaceDir = join(deployDir, "workspace");
  const configDir = join(deployDir, "config");
  const dataDir = join(deployDir, "data");

  // Create directory structure
  mkdirSync(join(workspaceDir, "skills"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(dataDir, "cron"), { recursive: true });

  // Copy role SKILL.md into workspace
  const roleTemplateDir = join(templatesDir, "roles", config.role);
  const roleSkillDir = join(workspaceDir, "skills", config.role);
  mkdirSync(roleSkillDir, { recursive: true });

  const skillMdPath = join(roleTemplateDir, "SKILL.md");
  if (existsSync(skillMdPath)) {
    cpSync(skillMdPath, join(roleSkillDir, "SKILL.md"));
  }

  // Copy cron jobs if they exist for this role
  const cronJobsPath = join(roleTemplateDir, "cron-jobs.json");
  if (existsSync(cronJobsPath)) {
    cpSync(cronJobsPath, join(dataDir, "cron", "jobs.json"));
  }

  // Generate AGENTS.md
  const agentsMd = generateAgentsMd(config);
  writeFileSync(join(workspaceDir, "AGENTS.md"), agentsMd, "utf8");

  // Create empty audit log
  const auditPath = join(dataDir, "audit.jsonl");
  if (!existsSync(auditPath)) {
    writeFileSync(auditPath, "", "utf8");
  }

  // Copy plugins to extensions directory for OpenClaw auto-discovery
  const extensionsDir = join(configDir, "extensions");
  copyPluginIfEnabled(config, "router", "clawforce-router", extensionsDir);
  copyPluginIfEnabled(config, "compliance", "clawforce-compliance", extensionsDir);
}

function copyPluginIfEnabled(
  config: ClawforceConfig,
  configKey: "router" | "compliance",
  pluginDirName: string,
  extensionsDir: string,
): void {
  const pluginConfig = config[configKey];
  if (!pluginConfig || pluginConfig.enabled === false) return;

  const srcDir = join(__dirname, "..", "plugins", pluginDirName);
  if (!existsSync(srcDir)) return;

  const destDir = join(extensionsDir, pluginDirName);
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts") && !src.includes("__tests__"),
  });
}
