import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseConfig } from "../../src/config/parse.js";
import { generateOpenClawConfig } from "../../src/config/generate-openclaw.js";
import { generateCompose } from "../../src/config/generate-compose.js";
import { generateEnv } from "../../src/config/generate-env.js";
import { setupWorkspace } from "../../src/workspace/setup.js";

const fixturesDir = join(import.meta.dirname, "../fixtures");
const testDeployDir = resolve("./test-deployment-integration");

/**
 * Integration test that validates the full config-to-deployment-dir pipeline
 * without actually starting Docker containers.
 *
 * Run with: INTEGRATION_TEST=1 pnpm test test/integration/
 */
describe("Deploy Lifecycle Integration", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-integration-test";
    if (existsSync(testDeployDir)) {
      rmSync(testDeployDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    if (existsSync(testDeployDir)) {
      rmSync(testDeployDir, { recursive: true, force: true });
    }
  });

  it("should parse config, generate all files, and setup workspace", () => {
    // 1. Parse config
    const config = parseConfig(join(fixturesDir, "valid-config.yaml"));
    expect(config.name).toBe("test-corp");
    expect(config.agents[0].role).toBe("inbox-analyst");

    // 2. Setup workspace
    setupWorkspace(config, testDeployDir);

    // 3. Generate openclaw.json (returns Map<string, OpenClawConfig>)
    const openclawConfigMap = generateOpenClawConfig(config);
    const { writeFileSync, mkdirSync } = require("node:fs");
    mkdirSync(join(testDeployDir, "config"), { recursive: true });
    const defaultConfig = openclawConfigMap.get("default");
    writeFileSync(
      join(testDeployDir, "config", "openclaw.json"),
      JSON.stringify(defaultConfig, null, 2),
      "utf8",
    );

    // 4. Generate docker-compose.yml
    const composeYaml = generateCompose(config);
    writeFileSync(
      join(testDeployDir, "docker-compose.yml"),
      composeYaml,
      "utf8",
    );

    // 5. Generate .env
    const env = generateEnv(config);
    writeFileSync(join(testDeployDir, ".env"), env, "utf8");

    // Verify complete directory structure
    expect(existsSync(join(testDeployDir, "workspace"))).toBe(true);
    expect(existsSync(join(testDeployDir, "workspace/AGENTS.md"))).toBe(true);
    expect(
      existsSync(
        join(testDeployDir, "workspace/test-agent/skills/inbox-analyst/SKILL.md"),
      ),
    ).toBe(true);
    expect(existsSync(join(testDeployDir, "config/openclaw.json"))).toBe(true);
    expect(existsSync(join(testDeployDir, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(testDeployDir, ".env"))).toBe(true);
    expect(existsSync(join(testDeployDir, "data/audit.jsonl"))).toBe(true);
    expect(existsSync(join(testDeployDir, "data/cron/jobs.json"))).toBe(true);

    // Verify openclaw.json content
    const oc = JSON.parse(
      readFileSync(join(testDeployDir, "config/openclaw.json"), "utf8"),
    );
    expect(oc.agents.defaults.model.primary).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect(oc.agents.defaults.model.fallbacks).toContain(
      "ollama/llama3.3:8b",
    );
    expect(oc.channels.discord.enabled).toBe(true);
    expect(oc.cron.enabled).toBe(true);
    expect(oc.hooks.enabled).toBe(true);

    // Verify docker-compose.yml content
    const compose = parseYaml(
      readFileSync(join(testDeployDir, "docker-compose.yml"), "utf8"),
    );
    expect(compose.services["openclaw-gateway"]).toBeDefined();
    expect(compose.services.ollama).toBeDefined();
    expect(compose.services["openclaw-gateway"].container_name).toBe(
      "clawforce-test-corp-gateway",
    );

    // Verify .env content
    const envContent = readFileSync(join(testDeployDir, ".env"), "utf8");
    expect(envContent).toContain("GATEWAY_TOKEN=");
    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-integration-test");

    // Verify AGENTS.md content
    const agentsMd = readFileSync(
      join(testDeployDir, "workspace/AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("test-corp");
    expect(agentsMd).toContain("Inbox Analyst");
    expect(agentsMd).toContain("hybrid");

    // Verify cron jobs
    const cronJobs = JSON.parse(
      readFileSync(join(testDeployDir, "data/cron/jobs.json"), "utf8"),
    );
    expect(cronJobs[0].name).toBe("daily-briefing");
    expect(cronJobs[0].schedule.expr).toBe("0 8 * * 1-5");
  });

  it("should work with minimal config (no ollama, no approval)", () => {
    const minDir = resolve("./test-deployment-minimal");
    try {
      const config = parseConfig(join(fixturesDir, "minimal-config.yaml"));
      setupWorkspace(config, minDir);

      const openclawConfigMap = generateOpenClawConfig(config);
      const { writeFileSync, mkdirSync } = require("node:fs");
      mkdirSync(join(minDir, "config"), { recursive: true });
      const defaultConfig = openclawConfigMap.get("default");
      writeFileSync(
        join(minDir, "config", "openclaw.json"),
        JSON.stringify(defaultConfig, null, 2),
        "utf8",
      );

      const composeYaml = generateCompose(config);
      writeFileSync(join(minDir, "docker-compose.yml"), composeYaml, "utf8");

      // Verify no ollama in compose
      const compose = parseYaml(
        readFileSync(join(minDir, "docker-compose.yml"), "utf8"),
      );
      expect(compose.services.ollama).toBeUndefined();

      // Verify research-agent skill
      expect(
        existsSync(
          join(minDir, "workspace/research-agent/skills/research-agent/SKILL.md"),
        ),
      ).toBe(true);

      // No cron jobs for research-agent
      expect(existsSync(join(minDir, "data/cron/jobs.json"))).toBe(false);
    } finally {
      if (existsSync(minDir)) {
        rmSync(minDir, { recursive: true, force: true });
      }
    }
  });

  it("should generate host runtime compose and env for mac mini profile", () => {
    const hostDir = resolve("./test-deployment-host-runtime");
    try {
      const config = parseConfig(join(fixturesDir, "runtime-host-ollama.yaml"));
      setupWorkspace(config, hostDir);

      const { writeFileSync, mkdirSync } = require("node:fs");
      mkdirSync(join(hostDir, "config"), { recursive: true });
      const hostConfigMap = generateOpenClawConfig(config);
      writeFileSync(
        join(hostDir, "config", "openclaw.json"),
        JSON.stringify(hostConfigMap.get("default"), null, 2),
        "utf8",
      );
      writeFileSync(join(hostDir, "docker-compose.yml"), generateCompose(config), "utf8");
      writeFileSync(join(hostDir, ".env"), generateEnv(config), "utf8");

      const compose = parseYaml(readFileSync(join(hostDir, "docker-compose.yml"), "utf8"));
      expect(compose.services.ollama).toBeUndefined();
      expect(compose.services["openclaw-gateway"].environment).toContain(
        "OLLAMA_HOST=http://host.docker.internal:11434",
      );
      expect(compose.services["openclaw-gateway"].extra_hosts).toContain(
        "host.docker.internal:host-gateway",
      );

      const envContent = readFileSync(join(hostDir, ".env"), "utf8");
      expect(envContent).toContain("OLLAMA_HOST=http://host.docker.internal:11434");
    } finally {
      if (existsSync(hostDir)) {
        rmSync(hostDir, { recursive: true, force: true });
      }
    }
  });
});
