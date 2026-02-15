import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Command "${command} ${args.join(" ")}" failed with code ${code}: ${stderr}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start command "${command}": ${err.message}`));
    });
  });
}
