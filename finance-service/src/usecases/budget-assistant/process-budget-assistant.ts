import { env } from "../../config/env.js";
import {
  currentMonthKey,
  filterBudgetAlerts,
  formatBudgetGuardrailMessage
} from "../../domains/budget/budget-status.js";
import { ensureBudgetSheets, readBudgetStatusRows } from "../../integrations/google-sheets/budget_sheets.js";

export async function processBudgetAssistant(): Promise<{ messages: string[] }> {
  await ensureBudgetSheets();
  const monthKey = currentMonthKey(new Date(), env.TZ);
  const rows = await readBudgetStatusRows();
  return {
    messages: [formatBudgetGuardrailMessage(rows, monthKey)]
  };
}

export async function buildBudgetAlertMessage(): Promise<string> {
  await ensureBudgetSheets();
  const monthKey = currentMonthKey(new Date(), env.TZ);
  const rows = await readBudgetStatusRows();
  const alerts = filterBudgetAlerts(rows, monthKey);
  if (alerts.length === 0) {
    return "";
  }
  return formatBudgetGuardrailMessage(rows, monthKey);
}
