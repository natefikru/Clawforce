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
}
