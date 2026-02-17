import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURES = join(ROOT, "test", "fixtures", "e2e");
const RUN_E2E = process.env.CLAWFORCE_RUN_E2E === "1";

const COMPLEX_PROMPT =
  "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, " +
  "event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements. " +
  "Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization.";

type CmdResult = ReturnType<typeof spawnSync>;

function runCmd(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = 240_000,
): CmdResult {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      // Ensure local e2e can bypass security-audit gate when explicitly enabled.
      CI: "",
      CLAWFORCE_SKIP_SECURITY_AUDIT: "1",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "sk-ant-e2e-test",
      ...env,
    },
  });
}

function assertOk(result: CmdResult, label: string) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed\nstatus=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function extractModel(output: string): string {
  const match = output.match(/Model:\s+([^\n]+)/);
  return match?.[1]?.trim() ?? "";
}

function extractProvider(modelRef: string): string {
  return modelRef.split("/")[0] ?? "";
}

function deploymentDirFromName(name: string): string {
  return join(ROOT, `clawforce-${name}`);
}

function composePathForDeployment(name: string): string {
  return join(deploymentDirFromName(name), "docker-compose.yml");
}

function tearDownDeployment(name: string) {
  const composeFile = composePathForDeployment(name);
  if (!existsSync(composeFile)) return;
  runCmd("docker", ["compose", "-f", composeFile, "down"], {}, 120_000);
}

function routeTest(prompt: string, configPath: string) {
  const result = runCmd("pnpm", ["dev", "route-test", prompt, "-c", configPath], {}, 120_000);
  assertOk(result, `route-test (${configPath})`);
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
  return {
    modelRef: extractModel(stdout),
    provider: extractProvider(extractModel(stdout)),
    raw: stdout,
  };
}

const dockerAvailable = runCmd("docker", ["--version"], {}, 10_000).status === 0;

const gatedDescribe = RUN_E2E && dockerAvailable ? describe : describe.skip;

gatedDescribe("Runtime pipeline e2e (deploy/status/audit/stop)", () => {
  it(
    "cloud profile boots runtime pipeline and enforces pii non-cloud routing",
    () => {
      const configPath = join(FIXTURES, "runtime-cloud.yaml");
      const deploymentName = "runtime-e2e-cloud";
      tearDownDeployment(deploymentName);

      try {
        assertOk(runCmd("pnpm", ["dev", "deploy", "-c", configPath]), "deploy cloud");
        assertOk(runCmd("pnpm", ["dev", "status"]), "status cloud");
        assertOk(
          runCmd("pnpm", ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"]),
          "audit cloud",
        );

        const complex = routeTest(COMPLEX_PROMPT, configPath);
        expect(complex.provider).toBe("anthropic");

        const pii = routeTest("my SSN is 123-45-6789", configPath);
        expect(["anthropic", "openai", "google"]).not.toContain(pii.provider);
      } finally {
        runCmd("pnpm", ["dev", "stop"], {}, 120_000);
        tearDownDeployment(deploymentName);
      }
    },
    300_000,
  );

  it(
    "local-only profile boots runtime pipeline and keeps routes local",
    () => {
      const configPath = join(FIXTURES, "runtime-local.yaml");
      const deploymentName = "runtime-e2e-local";
      tearDownDeployment(deploymentName);

      try {
        assertOk(runCmd("pnpm", ["dev", "deploy", "-c", configPath]), "deploy local");
        assertOk(runCmd("pnpm", ["dev", "status"]), "status local");
        assertOk(
          runCmd("pnpm", ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"]),
          "audit local",
        );

        const clean = routeTest("safe validation prompt", configPath);
        const pii = routeTest("my SSN is 123-45-6789", configPath);
        const complex = routeTest(COMPLEX_PROMPT, configPath);

        expect(clean.provider).toBe("ollama");
        expect(pii.provider).toBe("ollama");
        expect(complex.provider).toBe("ollama");
      } finally {
        runCmd("pnpm", ["dev", "stop"], {}, 120_000);
        tearDownDeployment(deploymentName);
      }
    },
    300_000,
  );

  it(
    "hybrid profile boots runtime pipeline and switches between cloud/local",
    () => {
      const configPath = join(FIXTURES, "runtime-hybrid.yaml");
      const deploymentName = "runtime-e2e-hybrid";
      tearDownDeployment(deploymentName);

      try {
        assertOk(runCmd("pnpm", ["dev", "deploy", "-c", configPath]), "deploy hybrid");
        assertOk(runCmd("pnpm", ["dev", "status"]), "status hybrid");
        assertOk(
          runCmd("pnpm", ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"]),
          "audit hybrid",
        );

        const low = routeTest("safe low complexity prompt", configPath);
        const pii = routeTest("my SSN is 123-45-6789", configPath);
        const complex = routeTest(COMPLEX_PROMPT, configPath);

        expect(low.provider).toBe("ollama");
        expect(pii.provider).toBe("ollama");
        expect(complex.provider).toBe("anthropic");
      } finally {
        runCmd("pnpm", ["dev", "stop"], {}, 120_000);
        tearDownDeployment(deploymentName);
      }
    },
    300_000,
  );
});

