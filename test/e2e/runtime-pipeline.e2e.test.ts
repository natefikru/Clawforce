import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURES = join(ROOT, "test", "fixtures", "e2e");
const RUN_E2E = process.env.CLAWFORCE_RUN_E2E === "1";

const COMPLEX_PROMPT =
  "Analyze the architectural trade-offs between microservices and monoliths considering CAP theorem implications, " +
  "event sourcing patterns, and CQRS for a distributed system handling 10M requests/second with strict consistency requirements. " +
  "Compare Kubernetes orchestration vs serverless approaches for deployment, discussing cold start latencies, resource utilization, and cost optimization.";

type CmdResult = ReturnType<typeof spawnSync>;
type RouteCheck = {
  label: string;
  prompt: string;
  expectedProviderConstraint: string;
  actualProvider: string;
  modelRef: string;
};

type ScenarioSummary = {
  scenario: string;
  config: string;
  deploymentName: string;
  commandChecks: string[];
  routeChecks: RouteCheck[];
};

const scenarioSummaries: ScenarioSummary[] = [];

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

function startScenario(
  scenario: string,
  configPath: string,
  deploymentName: string,
): ScenarioSummary {
  const entry: ScenarioSummary = {
    scenario,
    config: configPath,
    deploymentName,
    commandChecks: [],
    routeChecks: [],
  };
  scenarioSummaries.push(entry);
  return entry;
}

function runAndRecord(
  summary: ScenarioSummary,
  label: string,
  command: string,
  args: string[],
  timeoutMs = 240_000,
) {
  const result = runCmd(command, args, {}, timeoutMs);
  assertOk(result, label);
  summary.commandChecks.push(`${label}: ok`);
}

function recordRouteCheck(
  summary: ScenarioSummary,
  label: string,
  prompt: string,
  configPath: string,
  expectedProviderConstraint: string,
) {
  const result = routeTest(prompt, configPath);
  summary.routeChecks.push({
    label,
    prompt,
    expectedProviderConstraint,
    actualProvider: result.provider,
    modelRef: result.modelRef,
  });
  return result;
}

/**
 * Validates workspace-related artifacts after a deployment:
 * - docker-compose.yml has per-agent workspace volume mounts
 * - config/openclaw.json has agent workspace paths in agents.list
 * - workspace/AGENTS.md exists and contains agent names
 */
function validateWorkspaceArtifacts(
  deploymentName: string,
  expectedAgentNames: string[],
) {
  const deployDir = deploymentDirFromName(deploymentName);

  // Validate docker-compose.yml workspace volumes
  const composePath = join(deployDir, "docker-compose.yml");
  expect(existsSync(composePath)).toBe(true);
  const compose = parseYaml(readFileSync(composePath, "utf8"));
  const volumes = compose.services["openclaw-gateway"].volumes as string[];
  for (const agentName of expectedAgentNames) {
    const mount = volumes.find((v: string) =>
      v.includes(`:/home/node/.openclaw/workspace/${agentName}`),
    );
    expect(mount, `Missing workspace volume mount for agent '${agentName}'`).toBeDefined();
    // Host path should be absolute
    expect(isAbsolute(mount!.split(":")[0])).toBe(true);
  }

  // Validate openclaw.json agents.list
  const ocPath = join(deployDir, "config", "openclaw.json");
  expect(existsSync(ocPath)).toBe(true);
  const oc = JSON.parse(readFileSync(ocPath, "utf8"));
  expect(oc.agents.list).toHaveLength(expectedAgentNames.length);
  for (let i = 0; i < expectedAgentNames.length; i++) {
    expect(oc.agents.list[i].id).toBe(expectedAgentNames[i]);
    expect(oc.agents.list[i].workspace).toBe(
      `/home/node/.openclaw/workspace/${expectedAgentNames[i]}`,
    );
  }

  // Validate AGENTS.md
  const agentsMdPath = join(deployDir, "workspace", "AGENTS.md");
  expect(existsSync(agentsMdPath)).toBe(true);
  const agentsMd = readFileSync(agentsMdPath, "utf8");
  for (const agentName of expectedAgentNames) {
    expect(agentsMd).toContain(agentName);
  }
}

const dockerAvailable = runCmd("docker", ["--version"], {}, 10_000).status === 0;

const gatedDescribe = RUN_E2E && dockerAvailable ? describe : describe.skip;

gatedDescribe("Runtime pipeline e2e (deploy/status/audit/stop)", () => {
  it(
    "cloud profile boots runtime pipeline and enforces pii non-cloud routing",
    () => {
      const configPath = join(FIXTURES, "runtime-cloud.yaml");
      const deploymentName = "runtime-e2e-cloud";
      const summary = startScenario(
        "cloud profile boots runtime pipeline and enforces pii non-cloud routing",
        configPath,
        deploymentName,
      );
      tearDownDeployment(deploymentName);

      try {
        runAndRecord(summary, "deploy cloud", "pnpm", ["dev", "deploy", "-c", configPath]);
        validateWorkspaceArtifacts(deploymentName, ["inbox-analyst"]);
        runAndRecord(summary, "status cloud", "pnpm", ["dev", "status"]);
        runAndRecord(
          summary,
          "audit cloud",
          "pnpm",
          ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"],
        );

        const complex = recordRouteCheck(
          summary,
          "cloud complex prompt",
          COMPLEX_PROMPT,
          configPath,
          "provider must be anthropic",
        );
        expect(complex.provider).toBe("anthropic");

        const pii = recordRouteCheck(
          summary,
          "cloud pii prompt",
          "my SSN is 123-45-6789",
          configPath,
          "provider must not be cloud (anthropic/openai/google)",
        );
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
      const summary = startScenario(
        "local-only profile boots runtime pipeline and keeps routes local",
        configPath,
        deploymentName,
      );
      tearDownDeployment(deploymentName);

      try {
        runAndRecord(summary, "deploy local", "pnpm", ["dev", "deploy", "-c", configPath]);
        validateWorkspaceArtifacts(deploymentName, ["inbox-analyst"]);
        runAndRecord(summary, "status local", "pnpm", ["dev", "status"]);
        runAndRecord(
          summary,
          "audit local",
          "pnpm",
          ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"],
        );

        const clean = recordRouteCheck(
          summary,
          "local clean prompt",
          "safe validation prompt",
          configPath,
          "provider must be ollama",
        );
        const pii = recordRouteCheck(
          summary,
          "local pii prompt",
          "my SSN is 123-45-6789",
          configPath,
          "provider must be ollama",
        );
        const complex = recordRouteCheck(
          summary,
          "local complex prompt",
          COMPLEX_PROMPT,
          configPath,
          "provider must be ollama",
        );

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
      const summary = startScenario(
        "hybrid profile boots runtime pipeline and switches between cloud/local",
        configPath,
        deploymentName,
      );
      tearDownDeployment(deploymentName);

      try {
        runAndRecord(summary, "deploy hybrid", "pnpm", ["dev", "deploy", "-c", configPath]);
        validateWorkspaceArtifacts(deploymentName, ["inbox-analyst"]);
        runAndRecord(summary, "status hybrid", "pnpm", ["dev", "status"]);
        runAndRecord(
          summary,
          "audit hybrid",
          "pnpm",
          ["dev", "audit", "--source", "database", "--event", "routing_decision", "-n", "5"],
        );

        const low = recordRouteCheck(
          summary,
          "hybrid low complexity prompt",
          "safe low complexity prompt",
          configPath,
          "provider must be ollama",
        );
        const pii = recordRouteCheck(
          summary,
          "hybrid pii prompt",
          "my SSN is 123-45-6789",
          configPath,
          "provider must be ollama",
        );
        const complex = recordRouteCheck(
          summary,
          "hybrid complex prompt",
          COMPLEX_PROMPT,
          configPath,
          "provider must be anthropic",
        );

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

  it(
    "multi-agent deployment generates correct per-agent workspace artifacts",
    () => {
      const configPath = join(FIXTURES, "runtime-multi-agent.yaml");
      const deploymentName = "runtime-e2e-multi";
      const summary = startScenario(
        "multi-agent deployment generates correct per-agent workspace artifacts",
        configPath,
        deploymentName,
      );
      tearDownDeployment(deploymentName);

      try {
        runAndRecord(summary, "deploy multi", "pnpm", ["dev", "deploy", "-c", configPath]);

        // Validate per-agent workspace artifacts for both agents
        validateWorkspaceArtifacts(deploymentName, [
          "inbox-analyst",
          "research-agent",
        ]);

        // Verify compose has distinct volume mounts for each agent
        const deployDir = deploymentDirFromName(deploymentName);
        const compose = parseYaml(
          readFileSync(join(deployDir, "docker-compose.yml"), "utf8"),
        );
        const volumes = compose.services["openclaw-gateway"].volumes as string[];
        const agentMounts = volumes.filter((v: string) =>
          v.includes("/home/node/.openclaw/workspace/"),
        );
        // Base mount + 2 agent mounts
        expect(agentMounts.length).toBeGreaterThanOrEqual(2);
      } finally {
        runCmd("pnpm", ["dev", "stop"], {}, 120_000);
        tearDownDeployment(deploymentName);
      }
    },
    300_000,
  );
});

afterAll(() => {
  const summaryPath = process.env.CLAWFORCE_E2E_SUMMARY_PATH;
  if (!summaryPath) return;

  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scenarioCount: scenarioSummaries.length,
        scenarios: scenarioSummaries,
      },
      null,
      2,
    ),
    "utf8",
  );
});

