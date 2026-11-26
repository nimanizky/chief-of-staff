import assert from "node:assert/strict";
import {
  currentMonthKey,
  filterBudgetAlerts,
  formatBudgetGuardrailMessage,
  parseBudgetStatusRow
} from "../domains/budget/budget-status.js";

const rows = [
  parseBudgetStatusRow(["2026-07", "food", 1230000, 1500000, 0.82, 270000, "warning", "", "default"]),
  parseBudgetStatusRow(["2026-07", "dopamine", 420000, 300000, 1.4, -120000, "over", "", "default"]),
  parseBudgetStatusRow(["2026-07", "groceries", 100000, 1000000, 0.1, 900000, "ok", "", "default"]),
  parseBudgetStatusRow(["2026-06", "food", 1500000, 1500000, 1, 0, "over", "", "default"])
].filter((row) => row !== null);

assert.equal(currentMonthKey(new Date("2026-07-04T03:00:00.000Z"), "Asia/Jakarta"), "2026-07");
assert.equal(rows.length, 4);
assert.equal(filterBudgetAlerts(rows, "2026-07").length, 2);
assert.equal(filterBudgetAlerts(rows, "2026-07")[0].classification, "dopamine");

assert.equal(
  formatBudgetGuardrailMessage(rows, "2026-07"),
  [
    "Budget check - 2026-07",
    "dopamine: Rp420,000 / Rp300,000 (140%). Over by Rp120,000.",
    "food: Rp1,230,000 / Rp1,500,000 (82%). Remaining Rp270,000."
  ].join("\n")
);
assert.equal(
  formatBudgetGuardrailMessage(rows, "2026-05"),
  "Budget check - 2026-05\nAll tracked categories are still under guardrail."
);

console.log("budget guardrail tests passed");
