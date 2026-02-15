import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const templatesDir = join(import.meta.dirname, "../../../templates/roles");

const ROLES = ["inbox-analyst", "research-agent", "process-automator"] as const;

describe("Role Templates", () => {
  for (const role of ROLES) {
    describe(role, () => {
      const roleDir = join(templatesDir, role);

      it("should have a SKILL.md file", () => {
        expect(existsSync(join(roleDir, "SKILL.md"))).toBe(true);
      });

      it("should have valid YAML frontmatter in SKILL.md", () => {
        const content = readFileSync(join(roleDir, "SKILL.md"), "utf8");
        // Extract frontmatter between --- delimiters
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        expect(match).toBeTruthy();

        const frontmatter = parseYaml(match![1]) as Record<string, unknown>;
        expect(frontmatter.name).toBe(role);
        expect(typeof frontmatter.description).toBe("string");
        expect(
          (frontmatter.description as string).length,
        ).toBeGreaterThan(10);
      });

      it("should have metadata.openclaw.emoji in SKILL.md", () => {
        const content = readFileSync(join(roleDir, "SKILL.md"), "utf8");
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        const frontmatter = parseYaml(match![1]) as Record<string, unknown>;
        const metadata = frontmatter.metadata as Record<string, unknown>;
        expect(metadata).toBeDefined();
        const openclaw = metadata.openclaw as Record<string, unknown>;
        expect(openclaw).toBeDefined();
        expect(typeof openclaw.emoji).toBe("string");
      });

      it("should have a config.partial.json file", () => {
        expect(existsSync(join(roleDir, "config.partial.json"))).toBe(true);
      });

      it("should have valid JSON in config.partial.json", () => {
        const content = readFileSync(
          join(roleDir, "config.partial.json"),
          "utf8",
        );
        expect(() => JSON.parse(content)).not.toThrow();
      });

      it("should have hooks enabled in config partial", () => {
        const content = readFileSync(
          join(roleDir, "config.partial.json"),
          "utf8",
        );
        const parsed = JSON.parse(content);
        expect(parsed.hooks?.enabled).toBe(true);
      });
    });
  }

  describe("inbox-analyst specific", () => {
    const roleDir = join(templatesDir, "inbox-analyst");

    it("should have cron-jobs.json", () => {
      expect(existsSync(join(roleDir, "cron-jobs.json"))).toBe(true);
    });

    it("should have valid cron job format", () => {
      const content = readFileSync(join(roleDir, "cron-jobs.json"), "utf8");
      const jobs = JSON.parse(content);
      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);

      const job = jobs[0];
      expect(job.name).toBe("daily-briefing");
      expect(job.schedule.kind).toBe("cron");
      expect(job.schedule.expr).toBe("0 8 * * 1-5");
      expect(job.sessionTarget).toBe("isolated");
      expect(job.payload.kind).toBe("agentTurn");
      expect(job.delivery.mode).toBe("announce");
    });

    it("should enable cron in config partial", () => {
      const content = readFileSync(
        join(roleDir, "config.partial.json"),
        "utf8",
      );
      const parsed = JSON.parse(content);
      expect(parsed.cron?.enabled).toBe(true);
    });

    it("should have a README.md", () => {
      expect(existsSync(join(roleDir, "README.md"))).toBe(true);
    });
  });
});
