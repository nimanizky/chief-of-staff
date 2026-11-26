import { env } from "../config/env.js";
import { buildBudgetAlertMessage } from "../usecases/budget-assistant/process-budget-assistant.js";
import { sendOpenClawMessage } from "../integrations/openclaw/send_openclaw_message.js";

async function main() {
  if (!env.BUDGET_ALERT_ENABLED) {
    console.log("Budget alert is disabled.");
    return;
  }
  if (!env.BUDGET_ALERT_TARGET) {
    throw new Error("BUDGET_ALERT_TARGET is required when BUDGET_ALERT_ENABLED=true.");
  }

  const message = await buildBudgetAlertMessage();
  if (!message) {
    console.log("No budget warning/over rows for current month.");
    return;
  }

  await sendOpenClawMessage({
    channel: env.BUDGET_ALERT_CHANNEL,
    target: env.BUDGET_ALERT_TARGET,
    account: env.BUDGET_ALERT_ACCOUNT || undefined,
    message
  });
  console.log(`Sent budget alert to ${env.BUDGET_ALERT_CHANNEL}:${env.BUDGET_ALERT_TARGET}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
