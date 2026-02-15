import { exec } from "../docker/exec.js";
import { logger } from "../utils/logger.js";
import { findDeployDir } from "./status.js";

export async function stopCommand(): Promise<void> {
  logger.header("Clawforce Stop");

  const deployDir = findDeployDir();
  if (!deployDir) {
    logger.error("No deployment found in current directory.");
    return;
  }

  try {
    await exec("docker", ["compose", "down"], { cwd: deployDir });
    logger.success("Deployment stopped.");
  } catch (error) {
    logger.error(
      `Failed to stop: ${error instanceof Error ? error.message : error}`,
    );
  }
}
