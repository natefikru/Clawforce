import { ALLOWED_PLUGIN_PERMISSIONS } from "./permissions.js";
import type { OpenClawPluginManifest } from "./manifest-schema.js";

const ALLOWED_PERMISSION_SET = new Set<string>(ALLOWED_PLUGIN_PERMISSIONS);
const CAPABILITY_PERMISSION_REQUIREMENTS: Record<string, string[]> = {
  routing: ["hooks:before_agent_start"],
  "output-filtering": ["hooks:message_sending", "hooks:tool_result_persist"],
  alerting: ["alerts:dispatch"],
  "policy-enforcement": ["hooks:before_agent_start"],
  "compliance-logging": [
    "hooks:after_tool_call",
    "hooks:message_received",
    "hooks:message_sent",
  ],
  "audit-events": ["storage:write"],
};

export function enforcePluginSecurityPolicy(manifest: OpenClawPluginManifest): void {
  const declaredPermissions = new Set(manifest.permissions);

  for (const permission of manifest.permissions) {
    if (!ALLOWED_PERMISSION_SET.has(permission)) {
      throw new Error(
        `Plugin "${manifest.id}" declares unsupported permission "${permission}"`,
      );
    }
  }

  for (const capability of manifest.capabilities) {
    const requiredPermissions = CAPABILITY_PERMISSION_REQUIREMENTS[capability];
    if (!requiredPermissions) continue;

    for (const requiredPermission of requiredPermissions) {
      if (!declaredPermissions.has(requiredPermission)) {
        throw new Error(
          `Plugin "${manifest.id}" capability "${capability}" requires permission "${requiredPermission}"`,
        );
      }
    }
  }
}

