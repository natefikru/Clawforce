import { type ClawforceConfig } from "../config/types.js";

export function generateAgentsMd(config: ClawforceConfig): string {
  const approvalMode = config.approval?.mode ?? "autonomous";

  let content = `# Clawforce AI Workforce

This is a multi-agent deployment managed by Clawforce for ${config.name}.
Multiple specialized AI agents work alongside the human team.

## Global Rules

1. All agents follow the approval workflow for sensitive actions.
2. All agents log actions to the shared audit trail.
3. Agents never share information between channels unless explicitly asked.
4. Agents never store or repeat credentials, passwords, or API keys.
5. All agents are concise and professional.
6. When uncertain, agents ask for clarification rather than guessing.

## Deployed Agents

`;

  for (const agent of config.agents) {
    content += `### ${agent.name}\n\n`;

    if (agent.supervises && agent.supervises.length > 0) {
      content += `**Supervises**: ${agent.supervises.join(", ")}\n\n`;
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

  const sensitivityKeywords = config.routing?.sensitivity?.keywords;
  if (sensitivityKeywords && sensitivityKeywords.length > 0) {
    content += `\n## Data Sensitivity\n\nKeywords that trigger local-only routing:\n`;
    for (const term of sensitivityKeywords) {
      content += `- ${term}\n`;
    }
  }

  return content;
}
