export type BudgetStatus = "ok" | "warning" | "over" | "missing_budget";

export type BudgetStatusRow = {
  month_key: string;
  classification: string;
  actual_amount: number;
  budget_amount: number;
  used_pct: number;
  remaining_amount: number;
  status: BudgetStatus;
  message: string;
  budget_source: string;
};

const BUDGET_STATUS_VALUES = new Set(["ok", "warning", "over", "missing_budget"]);

export function parseBudgetStatusRow(row: unknown[]): BudgetStatusRow | null {
  const monthKey = toText(row[0]);
  const classification = toText(row[1]);
  if (!monthKey || !classification || monthKey === "month_key") return null;

  const status = toText(row[6]) || "ok";
  return {
    month_key: monthKey,
    classification,
    actual_amount: toNumber(row[2]),
    budget_amount: toNumber(row[3]),
    used_pct: toNumber(row[4]),
    remaining_amount: toNumber(row[5]),
    status: BUDGET_STATUS_VALUES.has(status) ? (status as BudgetStatus) : "ok",
    message: toText(row[7]),
    budget_source: toText(row[8])
  };
}

export function currentMonthKey(date = new Date(), timeZone = "Asia/Jakarta"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    return date.toISOString().slice(0, 7);
  }
  return `${year}-${month}`;
}

export function filterBudgetAlerts(rows: BudgetStatusRow[], monthKey: string): BudgetStatusRow[] {
  return rows
    .filter((row) => row.month_key === monthKey)
    .filter((row) => row.status === "warning" || row.status === "over")
    .sort((left, right) => {
      const severity = statusRank(right.status) - statusRank(left.status);
      if (severity !== 0) return severity;
      return right.used_pct - left.used_pct;
    });
}

export function formatBudgetGuardrailMessage(rows: BudgetStatusRow[], monthKey: string): string {
  const alerts = filterBudgetAlerts(rows, monthKey);
  if (alerts.length === 0) {
    return `Budget check - ${monthKey}\nAll tracked categories are still under guardrail.`;
  }

  return [`Budget check - ${monthKey}`, ...alerts.map(formatBudgetAlertLine)].join("\n");
}

export function formatBudgetAlertLine(row: BudgetStatusRow): string {
  const usedPercent = `${Math.round(row.used_pct * 100)}%`;
  if (row.status === "over") {
    return `${row.classification}: ${rupiah(row.actual_amount)} / ${rupiah(row.budget_amount)} (${usedPercent}). Over by ${rupiah(Math.abs(row.remaining_amount))}.`;
  }

  return `${row.classification}: ${rupiah(row.actual_amount)} / ${rupiah(row.budget_amount)} (${usedPercent}). Remaining ${rupiah(row.remaining_amount)}.`;
}

function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString("en-US")}`;
}

function statusRank(status: BudgetStatus): number {
  if (status === "over") return 2;
  if (status === "warning") return 1;
  return 0;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]+/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
