#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

function todayDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function run(command, args, env = {}, timeoutMs = 15_000) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      ...env,
    },
  });
}

function asText(value) {
  return typeof value === "string" ? value : value?.toString("utf8") ?? "";
}

function hasDockerImage(imageName) {
  const inspect = run("docker", ["image", "inspect", imageName]);
  return inspect.status === 0;
}

async function isPortFree(port) {
  return await new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolvePort(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolvePort(true));
    });
  });
}

async function checkOllamaHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function writeReport(report) {
  const outDir = join(ROOT, "docs", "validation-evidence", todayDateStamp());
  ensureDir(outDir);
  const outPath = join(outDir, "runtime-e2e-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const dateStamp = todayDateStamp();
  const scenarioSummaryPath = join(
    ROOT,
    "docs",
    "validation-evidence",
    dateStamp,
    "runtime-e2e-scenarios.json",
  );
  const requiredPorts = [4411, 4412, 4413];
  const portResults = {};

  for (const port of requiredPorts) {
    portResults[port] = await isPortFree(port);
  }

  const dockerVersion = run("docker", ["--version"]);
  const dockerInfo = run("docker", ["info"], {}, 20_000);
  const openclawImagePresent = hasDockerImage("openclaw:local");
  const ollamaHealthy = await checkOllamaHealth();
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  const preflight = {
    anthropicApiKeyPresent: hasAnthropicKey,
    dockerAvailable: dockerVersion.status === 0,
    dockerDaemonHealthy: dockerInfo.status === 0,
    openclawImagePresent,
    ollamaHealthy,
    portsFree: portResults,
  };

  console.log("Runtime e2e preflight:");
  console.log(JSON.stringify(preflight, null, 2));

  const failures = [];
  if (!preflight.anthropicApiKeyPresent) {
    failures.push("Missing required env var: ANTHROPIC_API_KEY");
  }
  if (!preflight.dockerAvailable) {
    failures.push("Docker CLI not available in PATH");
  }
  if (!preflight.dockerDaemonHealthy) {
    failures.push("Docker daemon is not healthy (docker info failed)");
  }
  if (!preflight.openclawImagePresent) {
    failures.push(
      "Required Docker image missing: openclaw:local (build/tag it before running runtime e2e)",
    );
  }
  if (!preflight.ollamaHealthy) {
    failures.push("Local runtime check failed: Ollama not reachable at http://127.0.0.1:11434/api/tags");
  }
  for (const [port, free] of Object.entries(preflight.portsFree)) {
    if (!free) failures.push(`Required port is already in use: ${port}`);
  }

  if (failures.length > 0) {
    const failedReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "preflight_failed",
      preflight,
      failures,
    };
    const path = writeReport(failedReport);
    console.error("Runtime e2e preflight failed.");
    console.error(`Report: ${path}`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  const testRun = run(
    "pnpm",
    ["test:e2e:runtime"],
    {
      CLAWFORCE_RUN_E2E: "1",
      CLAWFORCE_E2E_SUMMARY_PATH: scenarioSummaryPath,
      // local validation safety gate control
      CI: "",
      CLAWFORCE_SKIP_SECURITY_AUDIT: "1",
    },
    20 * 60_000,
  );

  const stdout = asText(testRun.stdout);
  const stderr = asText(testRun.stderr);
  const scenarioSummary = readJsonIfExists(scenarioSummaryPath);
  const testResult = {
    statusCode: testRun.status,
    stdout,
    stderr,
  };

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: testRun.status === 0 ? "passed" : "failed",
    preflight,
    testResult,
    scenarioSummary,
  };
  const path = writeReport(report);

  if (testRun.status !== 0) {
    console.error("Runtime e2e execution failed.");
    console.error(`Report: ${path}`);
    console.error("--- Runtime e2e stdout (begin) ---");
    console.error(stdout);
    console.error("--- Runtime e2e stdout (end) ---");
    if (stderr.trim().length > 0) {
      console.error("--- Runtime e2e stderr (begin) ---");
      console.error(stderr);
      console.error("--- Runtime e2e stderr (end) ---");
    }
    process.exit(testRun.status ?? 1);
  }

  console.log("--- Runtime e2e stdout (begin) ---");
  console.log(stdout);
  console.log("--- Runtime e2e stdout (end) ---");
  if (stderr.trim().length > 0) {
    console.log("--- Runtime e2e stderr (begin) ---");
    console.log(stderr);
    console.log("--- Runtime e2e stderr (end) ---");
  }
  if (scenarioSummary) {
    console.log("--- Runtime e2e scenario summary ---");
    console.log(JSON.stringify(scenarioSummary, null, 2));
  } else {
    console.log("Runtime e2e scenario summary not found.");
  }
  console.log("Runtime e2e execution passed.");
  console.log(`Report: ${path}`);
}

await main();

