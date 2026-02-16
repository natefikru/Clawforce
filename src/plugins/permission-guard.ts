export function getPluginPermissions(pluginConfig?: Record<string, unknown>): Set<string> {
  const raw = pluginConfig?.pluginPermissions;
  if (!Array.isArray(raw)) return new Set<string>();
  const values = raw.filter((item): item is string => typeof item === "string");
  return new Set(values);
}

export function assertHookPermission(
  pluginId: string,
  permissions: ReadonlySet<string>,
  hookName: string,
): void {
  const requiredPermission = `hooks:${hookName}`;
  assertPermission(pluginId, permissions, requiredPermission, `register hook "${hookName}"`);
}

export function assertPermission(
  pluginId: string,
  permissions: ReadonlySet<string>,
  permission: string,
  action: string,
): void {
  const requiredPermission = permission;
  if (!permissions.has(requiredPermission)) {
    throw new Error(
      `Plugin "${pluginId}" cannot ${action} without permission "${requiredPermission}"`,
    );
  }
}

