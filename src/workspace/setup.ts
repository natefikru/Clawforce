import { mkdirSync, cpSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ClawforceConfig } from "../config/types.js";
import { generateAgentsMd } from "./agents-md.js";
import {
  buildPluginsToExtensions,
  enabledPluginsForConfig,
} from "../plugins/compiler.js";

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

  // Copy role SKILL.md into workspace for each agent
  for (const agent of config.agents) {
    const agentSkillDir = join(workspaceDir, agent.name, "skills", agent.role);
    mkdirSync(agentSkillDir, { recursive: true });
    const skillMdPath = join(templatesDir, "roles", agent.role, "SKILL.md");
    if (existsSync(skillMdPath)) {
      cpSync(skillMdPath, join(agentSkillDir, "SKILL.md"));
    }
    const cronJobsPath = join(templatesDir, "roles", agent.role, "cron-jobs.json");
    const targetCronPath = join(dataDir, "cron", "jobs.json");
    if (existsSync(cronJobsPath) && !existsSync(targetCronPath)) {
      cpSync(cronJobsPath, targetCronPath);
    }
  }

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
