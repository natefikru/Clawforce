import { type ClawforceConfig, isSingleAgentConfig } from "../config/types.js";

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  "inbox-analyst": "Inbox Analyst",
  "research-agent": "Research Agent",
  "process-automator": "Process Automator",
  "supervisor": "Supervisor",
};

export function generateAgentsMd(config: ClawforceConfig): string {
  if (isSingleAgentConfig(config)) {
    return generateSingleAgentMd(config);
  }
  return generateMultiAgentMd(config);
}

function generateSingleAgentMd(config: ClawforceConfig & { role: string }): string {
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

function generateMultiAgentMd(config: ClawforceConfig): string {
  const approvalMode = config.approval?.mode ?? "autonomous";

  let content = `# Clawforce AI Workforce

This is a multi-agent deployment managed by Clawforce for ${config.name}.
Multiple specialized AI agents work alongside the human team, each with distinct roles and responsibilities.

## Global Rules

1. All agents follow the approval workflow for sensitive actions.
2. All agents log actions to the shared audit trail.
3. Agents never share information between channels unless explicitly asked.
4. Agents never store or repeat credentials, passwords, or API keys.
5. All agents are concise and professional.
6. When uncertain, agents ask for clarification rather than guessing.

## Deployed Agents

`;

  if (config.agents) {
    for (const agent of config.agents) {
      const roleName = ROLE_DISPLAY_NAMES[agent.role] ?? agent.role;
      content += `### ${agent.name} (${roleName})\n\n`;

      if (agent.channels && agent.channels.length > 0) {
        content += `**Channels**: `;
        const channelNames: string[] = [];
        for (const ch of agent.channels) {
          if (ch.type === "channel" && ch.channels) {
            channelNames.push(...ch.channels);
          } else if (ch.type === "dm" && ch.users) {
            channelNames.push(`DMs with ${ch.users.join(", ")}`);
          }
        }
        content += channelNames.join(", ") + "\n\n";
      }

      if (agent.supervises && agent.supervises.length > 0) {
        content += `**Supervises**: ${agent.supervises.join(", ")}\n\n`;
      }

      content += `See \`workspace/${agent.name}/skills/${agent.role}/SKILL.md\` for detailed instructions.\n\n`;
    }
  }

  content += `## Approval Mode

This deployment is in **${approvalMode}** mode.
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
