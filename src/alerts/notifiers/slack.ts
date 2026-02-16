import type { AlertEntry } from "../../storage/types.js";

export interface SlackNotifierConfig {
  enabled: boolean;
  webhookUrl?: string;
}

export async function sendSlackAlert(
  config: SlackNotifierConfig,
  alert: AlertEntry,
): Promise<void> {
  if (!config.enabled || !config.webhookUrl) return;

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `[clawforce] [${alert.severity}] ${alert.type}: ${alert.message}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*Clawforce Alert*\n` +
              `*Severity:* ${alert.severity}\n` +
              `*Type:* ${alert.type}\n` +
              `*Agent:* ${alert.agentId ?? "_global"}\n` +
              `*Message:* ${alert.message}`,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with status ${response.status}`);
  }
}
