import type { AlertEntry } from "../storage/types.js";
import { sendSlackAlert, type SlackNotifierConfig } from "./notifiers/slack.js";
import { sendEmailAlert, type EmailNotifierConfig } from "./notifiers/email.js";

export interface AlertNotificationConfig {
  slack: SlackNotifierConfig;
  email: EmailNotifierConfig;
}

export async function dispatchAlertNotifications(
  alert: AlertEntry,
  config: AlertNotificationConfig,
): Promise<void> {
  const results = await Promise.allSettled([
    sendSlackAlert(config.slack, alert),
    sendEmailAlert(config.email, alert),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`[alerts] Notification delivery failed: ${String(result.reason)}\n`);
    }
  }
}
