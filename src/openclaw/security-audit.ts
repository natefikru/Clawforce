import { exec } from "../docker/exec.js";

export interface SecurityAuditResult {
  skipped: boolean;
  output?: string;
  hasCriticalFindings: boolean;
}

interface RunSecurityAuditOptions {
  deployDir: string;
  skip?: boolean;
}

export async function runSecurityAudit(
  options: RunSecurityAuditOptions,
): Promise<SecurityAuditResult> {
  if (options.skip) {
    return { skipped: true, hasCriticalFindings: false };
  }

  let output = "";
  try {
    output = await exec(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "openclaw-gateway",
        "node",
        "dist/index.js",
        "security",
        "audit",
        "--deep",
      ],
      { cwd: options.deployDir },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Security audit failed to execute: ${reason}`);
  }

  const hasCriticalFindings = /\bcritical\b/i.test(output);
  return {
    skipped: false,
    output,
    hasCriticalFindings,
  };
}
