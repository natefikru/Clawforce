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
import { userAddCommand, userListCommand, userRemoveCommand } from "./commands/user.js";
import { pluginsWatchCommand } from "./commands/plugins-watch.js";

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

  program
    .command("plugins-watch")
    .description("Bundle plugins and watch for local changes")
    .option("-c, --config <path>", "Path to clawforce.yaml", "./clawforce.yaml")
    .option("--extensions-dir <path>", "Override extensions output directory")
    .option("--router", "Watch router plugin only")
    .option("--compliance", "Watch compliance plugin only")
    .action(async (options: { config: string; extensionsDir?: string; router?: boolean; compliance?: boolean }) => {
      try {
        await pluginsWatchCommand(options);
      } catch (error) {
        console.error(
          "Plugin watch failed:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  const user = program
    .command("user")
    .description("Manage dashboard users");

  user
    .command("add")
    .description("Add a dashboard user")
    .argument("<username>", "Username for the new user")
    .requiredOption("-p, --password <password>", "User password (min 8 chars)")
    .option("-r, --role <role>", "User role: admin or viewer", "viewer")
    .option("-d, --data-dir <dir>", "Data directory", "./data")
    .action(async (username: string, options: { password: string; role: string; dataDir: string }) => {
      try {
        await userAddCommand(username, options);
      } catch (error) {
        console.error(
          "Failed to add user:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  user
    .command("list")
    .description("List all dashboard users")
    .option("-d, --data-dir <dir>", "Data directory", "./data")
    .action(async (options: { dataDir: string }) => {
      try {
        await userListCommand(options);
      } catch (error) {
        console.error(
          "Failed to list users:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });

  user
    .command("remove")
    .description("Remove a dashboard user")
    .argument("<username>", "Username to remove")
    .option("-d, --data-dir <dir>", "Data directory", "./data")
    .action(async (username: string, options: { dataDir: string }) => {
      try {
        await userRemoveCommand(username, options);
      } catch (error) {
        console.error(
          "Failed to remove user:",
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
