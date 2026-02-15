import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deployCommand } from "./commands/deploy.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand } from "./commands/stop.js";
import { auditCommand } from "./commands/audit.js";
import { migrateCommand } from "./commands/migrate.js";
import { routeTestCommand } from "./commands/route-test.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("clawforce")
    .description("Deploy AI agents via OpenClaw and Docker Compose")
    .version(readVersion());

  program
    .command("deploy")
    .description("Deploy an AI agent from config")
    .option("-c, --config <path>", "Path to clawforce.yaml", "./clawforce.yaml")
    .action(async (options: { config: string }) => {
      try {
        await deployCommand(options.config);
      } catch (error) {
        console.error(
          "Deploy failed:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  program
    .command("status")
    .description("Check deployment status")
    .action(async () => {
      await statusCommand();
    });

  program
    .command("stop")
    .description("Stop deployment")
    .action(async () => {
      await stopCommand();
    });

  program
    .command("audit")
    .description("View audit log")
    .option("-n, --tail <lines>", "Number of lines to tail", "50")
    .option("-s, --source <source>", "Log source: container, compliance, or database", "container")
    .option("--since <timestamp>", "Filter events since ISO timestamp (database source)")
    .option("--event <type>", "Filter by event type (database source)")
    .option("--agent <id>", "Filter by agent ID (database source)")
    .option("--pii-only", "Show only PII-related routing decisions (database source)")
    .action(async (options: { tail: string; source: string; since?: string; event?: string; agent?: string; piiOnly?: boolean }) => {
      const validSources = ["container", "compliance", "database"] as const;
      const source = validSources.includes(options.source as typeof validSources[number])
        ? (options.source as typeof validSources[number])
        : "container";
      await auditCommand(parseInt(options.tail, 10), source, {
        since: options.since,
        event: options.event,
        agent: options.agent,
        piiOnly: options.piiOnly,
      });
    });

  program
    .command("migrate")
    .description("Migrate existing JSONL logs into SQLite database")
    .option("-d, --data-dir <dir>", "Data directory containing JSONL files", "./data")
    .option("--dry-run", "Report counts without inserting data")
    .action(async (options: { dataDir: string; dryRun?: boolean }) => {
      try {
        await migrateCommand({
          dataDir: options.dataDir,
          dryRun: options.dryRun,
        });
      } catch (error) {
        console.error(
          "Migration failed:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  program
    .command("route-test")
    .description("Test routing decision for a prompt")
    .argument("<prompt>", "The prompt to test routing for")
    .option("-c, --config <path>", "Path to clawforce.yaml", "./clawforce.yaml")
    .action(async (prompt: string, options: { config: string }) => {
      try {
        await routeTestCommand(options.config, prompt);
      } catch (error) {
        console.error(
          "Route test failed:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  return program;
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("clawforce.mjs") ||
    process.argv[1].endsWith("cli.ts") ||
    process.argv[1].endsWith("cli.js"))
) {
  const program = createProgram();
  program.parse();
}
