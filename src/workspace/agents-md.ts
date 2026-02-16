import type { ClawforceConfig } from "../config/types.js";

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  "inbox-analyst": "Inbox Analyst",
  "research-agent": "Research Agent",
  "process-automator": "Process Automator",
};

export function generateAgentsMd(config: ClawforceConfig): string {
  const roleName = ROLE_DISPLAY_NAMES[config.role] ?? config.role;
  const approvalMode = config.approval?.mode ?? "autonomous";

  let content = `# Clawforce AI Employee

You are an AI employee deployed by Clawforce for ${config.name}.
You work alongside the human team via configured OpenClaw channels.

## Rules

1. You follow the approval workflow for sensitive actions.
2. You log all actions to the audit trail.
3. You never share information between channels unless explicitly asked.
4. You never store or repeat credentials, passwords, or API keys.
5. You are concise and professional.
6. When uncertain, ask for clarification rather than guessing.

## Your Role

You are the **${roleName}**. See your role-specific SKILL.md for detailed instructions.

## Approval Mode

Your deployment is in **${approvalMode}** mode.
`;

  if (approvalMode === "hybrid" && config.approval?.require_approval_for) {
    content += `\nActions requiring approval:\n`;
    for (const action of config.approval.require_approval_for) {
      content += `- ${action}\n`;
    }
  }

  if (config.sensitivity?.blocklist && config.sensitivity.blocklist.length > 0) {
    content += `\n## Data Sensitivity\n\nBlocklist terms that trigger local-only routing:\n`;
    for (const term of config.sensitivity.blocklist) {
      content += `- ${term}\n`;
    }
  }

  return content;
}
