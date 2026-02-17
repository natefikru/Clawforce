import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ClawforceConfigSchema, type ClawforceConfig } from "./types.js";
import { expandEnvVars } from "../utils/env-vars.js";

export function parseConfig(configPath: string): ClawforceConfig {
  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const parsed = parseYaml(rawContent) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is empty or not a valid YAML object");
  }

  const expanded = expandEnvVars(parsed);

  // Backward-compatible default: if neither single-agent nor multi-agent mode is
  // explicitly selected, default to single-agent supervisor role.
  const normalized = { ...(expanded as Record<string, unknown>) };
  if (!Object.hasOwn(normalized, "role") && !Object.hasOwn(normalized, "agents")) {
    normalized.role = "supervisor";
  }

  const result = ClawforceConfigSchema.safeParse(normalized);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${errors}`);
  }

  return result.data;
}
