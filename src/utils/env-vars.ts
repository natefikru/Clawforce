/**
 * Recursively expand ${ENV_VAR} references in config values.
 * Throws if a referenced env var is not set.
 * Escaped with $${VAR} to produce literal ${VAR}.
 */
export function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\$\{([^}]+)\}/g, "\0ESCAPED:$1\0").replace(
      /\$\{([^}]+)\}/g,
      (_, varName: string) => {
        const value = process.env[varName];
        if (value === undefined || value === "") {
          throw new Error(`Environment variable ${varName} is not set`);
        }
        return value;
      },
    ).replace(/\0ESCAPED:([^}]+)\0/g, "${$1}");
  }

  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }

  return obj;
}
