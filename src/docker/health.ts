import { exec } from "./exec.js";

export async function waitForHealthy(
  containerName: string,
  cwd: string,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const output = await exec(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", containerName],
        { cwd },
      );
      if (output.trim() === "true") {
        return true;
      }
    } catch {
      // Container not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}
