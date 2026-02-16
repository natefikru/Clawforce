export const ALLOWED_PLUGIN_PERMISSIONS = [
  "hooks:before_agent_start",
  "hooks:after_tool_call",
  "hooks:message_received",
  "hooks:message_sending",
  "hooks:message_sent",
  "hooks:tool_result_persist",
  "hooks:agent_end",
  "storage:write",
  "alerts:dispatch",
  "config:read",
] as const;

export type PluginPermission = (typeof ALLOWED_PLUGIN_PERMISSIONS)[number];

