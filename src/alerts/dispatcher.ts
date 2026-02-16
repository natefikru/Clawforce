import type { AlertEntry } from "../storage/types.js";
import { sendEmailAlert, type EmailNotifierConfig } from "./notifiers/email.js";

export interface AlertNotificationConfig {
  email: EmailNotifierConfig;
}

export async function dispatchAlertNotifications(
  alert: AlertEntry,
  config: AlertNotificationConfig,
): Promise<void> {
  const results = await Promise.allSettled([
    sendEmailAlert(config.email, alert),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`[alerts] Notification delivery failed: ${String(result.reason)}\n`);
    }
  }
}
