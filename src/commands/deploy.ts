import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { parseConfig } from "../config/parse.js";
import { generateOpenClawConfig } from "../config/generate-openclaw.js";
import { generateCompose } from "../config/generate-compose.js";
import { generateEnv } from "../config/generate-env.js";
import { setupWorkspace } from "../workspace/setup.js";
import { exec } from "../docker/exec.js";
import { waitForHealthy } from "../docker/health.js";
import { getDatabase, closeDatabase } from "../storage/database.js";
import { logger } from "../utils/logger.js";
import { runSecurityAudit } from "../openclaw/security-audit.js";

export async function deployCommand(configPath: string): Promise<void> {
  logger.header("Clawforce Deploy");

  // 1. Parse and validate config
  logger.step("Parsing config...");
  const config = parseConfig(configPath);
  logger.success(`Config valid: ${config.name} (${config.role})`);

  // 2. Create deployment directory
  const deployDir = resolve(`./clawforce-${config.name}`);
  mkdirSync(deployDir, { recursive: true });
  logger.info(`Deploy directory: ${deployDir}`);

  // 3. Setup workspace (creates dirs, copies templates)
  logger.step("Setting up workspace...");
  setupWorkspace(config, deployDir);
  logger.success("Workspace ready");

  // 4. Generate openclaw.json
  logger.step("Generating openclaw.json...");
  const openclawConfig = generateOpenClawConfig(config);
  writeFileSync(
    join(deployDir, "config", "openclaw.json"),
    JSON.stringify(openclawConfig, null, 2),
    "utf8",
  );
  logger.success("openclaw.json generated");

  // 5. Generate docker-compose.yml
  logger.step("Generating docker-compose.yml...");
  const composeYaml = generateCompose(config);
  writeFileSync(join(deployDir, "docker-compose.yml"), composeYaml, "utf8");
  logger.success("docker-compose.yml generated");

  // 6. Generate .env
  logger.step("Generating .env...");
  const env = generateEnv(config);
  writeFileSync(join(deployDir, ".env"), env, { mode: 0o600, flag: "w" });
  logger.success(".env generated");

  // 6b. Seed admin user if dashboard auth is enabled
  if (config.dashboard?.auth?.enabled && config.dashboard.auth.username && config.dashboard.auth.password) {
    logger.step("Seeding dashboard admin user...");
    const dataDir = join(deployDir, "data");
    mkdirSync(dataDir, { recursive: true });
    const db = getDatabase(join(dataDir, "clawforce.db"));
    try {
      const existing = db
        .prepare("SELECT id FROM dashboard_users WHERE username = ?")
        .get(config.dashboard.auth.username) as { id: string } | undefined;

      if (!existing) {
        const { hash } = await import("bcryptjs");
        const passwordHash = await hash(config.dashboard.auth.password, 10);
        db.prepare(
          "INSERT INTO dashboard_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        ).run(randomUUID(), config.dashboard.auth.username, passwordHash, "admin");
        logger.success(`Admin user "${config.dashboard.auth.username}" seeded.`);
      } else {
        logger.info(`Admin user "${config.dashboard.auth.username}" already exists, skipping.`);
      }
    } finally {
      closeDatabase();
    }
  }

  // 7. Build dashboard image if enabled
  if (config.dashboard && config.dashboard.enabled !== false) {
    logger.step("Building dashboard image...");
    const dashboardDir = join(__dirname, "..", "..", "clawforce-dashboard");
    await exec("docker", [
      "build", "-t", "clawforce-dashboard:local", dashboardDir,
    ]);
    logger.success("Dashboard image built");
  }

  // 8. Pull Ollama model if configured as a managed container runtime
  const runtimeEngine = config.runtime?.engine;
  const runtimeLocation = config.runtime?.location ?? "container";
  const shouldPullOllamaModel =
    runtimeEngine === "ollama" && runtimeLocation === "container";
  const ollamaModelToPull = shouldPullOllamaModel
    ? (config.runtime?.model ?? "llama3.3:8b")
    : undefined;

  if (shouldPullOllamaModel && ollamaModelToPull) {
    logger.step(`Starting Ollama and pulling model: ${ollamaModelToPull}...`);
    await exec("docker", ["compose", "up", "-d", "ollama"], {
      cwd: deployDir,
    });
    await exec(
      "docker",
      [
        "exec",
        `clawforce-${config.name}-ollama`,
        "ollama",
        "pull",
        ollamaModelToPull,
      ],
      { cwd: deployDir },
    );
    logger.success("Ollama model ready");
  }

  // 9. Start gateway
  logger.step("Starting OpenClaw gateway...");
  await exec("docker", ["compose", "up", "-d"], { cwd: deployDir });
  logger.success("Containers started");

  // 10. Health check
  logger.step("Waiting for container to start...");
  const containerName = `clawforce-${config.name}-gateway`;
  const healthy = await waitForHealthy(containerName, deployDir, 30000);

  if (!healthy) {
    throw new Error(
      "Container failed to start after 30s. Check logs with: docker compose logs",
    );
  }

  // 11. Run OpenClaw security audit gate
  const skipSecurityAudit = process.env.CLAWFORCE_SKIP_SECURITY_AUDIT === "1";
  const bypassAllowed = isAuditBypassAllowed();
  if (skipSecurityAudit && !bypassAllowed) {
    throw new Error(
      "Security audit bypass is not allowed in CI or production. Unset CLAWFORCE_SKIP_SECURITY_AUDIT.",
    );
  }
  if (skipSecurityAudit) {
    logger.warn(
      "Skipping OpenClaw security audit because CLAWFORCE_SKIP_SECURITY_AUDIT=1 is set.",
    );
  } else {
    logger.step("Running OpenClaw security audit...");
  }

  const auditResult = await runSecurityAudit({
    deployDir,
    skip: skipSecurityAudit,
  });

  if (auditResult.hasCriticalFindings) {
    throw new Error(
      "Security audit failed: critical findings detected. Fix findings or set CLAWFORCE_SKIP_SECURITY_AUDIT=1 for local-only testing.",
    );
  }

  if (!auditResult.skipped) {
    logger.success("Security audit passed (no critical findings)");
  }

  logger.header("Deployment successful!");
  logger.info(`Gateway:          ws://127.0.0.1:18789`);
  logger.info(`Role:             ${config.role}`);
  logger.info(`Deploy dir:       ${deployDir}`);
  if (config.dashboard && config.dashboard.enabled !== false) {
    const port = config.dashboard.port ?? 3000;
    logger.info(`Dashboard:        http://localhost:${port}`);
  }
  logger.info("");
  logger.info("Manage with:");
  logger.info("  clawforce status   - Check container status");
  logger.info("  clawforce audit    - View audit log");
  logger.info("  clawforce stop     - Stop deployment");
}

function isAuditBypassAllowed(): boolean {
  if (isCiEnvironment()) return false;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

function isCiEnvironment(): boolean {
  const value = process.env.CI;
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}
