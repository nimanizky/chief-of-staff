import type {
  FinanceSourceResult,
  PaymentCalendarRow,
  ReceiptQualityRow,
  WeeklySpendRow
} from "../../domains/finance/finance-digest.js";

export type FinanceSheetCell = string | number | boolean | null | undefined;
export type FinanceSheetRows = FinanceSheetCell[][];

export function parseWeeklySpend(rows: FinanceSheetRows): FinanceSourceResult<WeeklySpendRow> {
  const table = tableReader(rows, ["week_start", "week_end", "payment_method", "amount_spent"]);
  const parsed: WeeklySpendRow[] = [];
  let invalidRows = 0;

  for (const row of table.rows) {
    const weekStart = parseSheetDate(table.get(row, "week_start"));
    const weekEnd = parseSheetDate(table.get(row, "week_end"));
    const paymentMethod = textValue(table.get(row, "payment_method"));
    const amountCell = table.get(row, "amount_spent");
    const amountSpent = isBlank(amountCell) ? 0 : parseAmount(amountCell);
    if (!weekStart || !weekEnd || !paymentMethod || amountSpent === null) {
      invalidRows += 1;
      continue;
    }
    parsed.push({ weekStart, weekEnd, paymentMethod, amountSpent });
  }

  return {
    rows: parsed,
    warnings: invalidRows > 0 ? [`${invalidRows} invalid weekly spend row(s) were excluded.`] : []
  };
}

export function parsePaymentCalendar(rows: FinanceSheetRows): FinanceSourceResult<PaymentCalendarRow> {
  const table = tableReader(rows, ["due_date", "payment_method", "amount_due"]);
  const parsed: PaymentCalendarRow[] = [];
  let invalidRows = 0;

  for (const row of table.rows) {
    const dueDate = parseSheetDate(table.get(row, "due_date"));
    const paymentMethod = textValue(table.get(row, "payment_method"));
    const amountDue = parseAmount(table.get(row, "amount_due"));
    if (!dueDate || !paymentMethod || amountDue === null) {
      invalidRows += 1;
      continue;
    }
    parsed.push({ dueDate, paymentMethod, amountDue });
  }

  return {
    rows: parsed,
    warnings: invalidRows > 0 ? [`${invalidRows} invalid payment calendar row(s) were excluded.`] : []
  };
}

export function parseReceiptQuality(rows: FinanceSheetRows): FinanceSourceResult<ReceiptQualityRow> {
  const table = tableReader(rows, ["receipt_date", "payment_method", "needs_review"]);
  const parsed: ReceiptQualityRow[] = [];
  let invalidRows = 0;

  for (const row of table.rows) {
    const receiptDate = parseSheetDate(table.get(row, "receipt_date"));
    if (!receiptDate) {
      invalidRows += 1;
      continue;
    }
    parsed.push({
      receiptDate,
      paymentMethod: textValue(table.get(row, "payment_method")),
      needsReview: booleanValue(table.get(row, "needs_review"))
    });
  }

  return {
    rows: parsed,
    warnings: invalidRows > 0 ? [`${invalidRows} receipt row(s) with invalid dates were excluded.`] : []
  };
}

function tableReader(rows: FinanceSheetRows, requiredHeaders: string[]) {
  const header = (rows[0] ?? []).map((cell) => textValue(cell).toLowerCase());
  const indices = new Map<string, number>();
  for (const required of requiredHeaders) {
    const matches = header.flatMap((value, index) => (value === required ? [index] : []));
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Missing required Sheet header: ${required}`
          : `Duplicate required Sheet header: ${required}`
      );
    }
    indices.set(required, matches[0]);
  }

  return {
    rows: rows
      .slice(1)
      .filter((row) => [...indices.values()].some((index) => !isBlank(row[index]))),
    get(row: FinanceSheetCell[], headerName: string): FinanceSheetCell {
      return row[indices.get(headerName) as number];
    }
  };
}

function parseAmount(value: FinanceSheetCell): number | null {
  let amount: number;
  if (typeof value === "number") {
    amount = value;
  } else {
    const currency = textValue(value).replace(/\s/g, "").replace(/^rp/i, "");
    const validInteger = /^\d+$/.test(currency);
    const validDotGroups = /^\d{1,3}(?:\.\d{3})+$/.test(currency);
    const validCommaGroups = /^\d{1,3}(?:,\d{3})+$/.test(currency);
    if (!validInteger && !validDotGroups && !validCommaGroups) return null;
    amount = Number(currency.replace(/[.,]/g, ""));
  }
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseSheetDate(value: FinanceSheetCell): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  }

  const raw = textValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

function booleanValue(value: FinanceSheetCell): boolean {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes"].includes(textValue(value).toLowerCase());
}

function textValue(value: FinanceSheetCell): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isBlank(value: FinanceSheetCell): boolean {
  return textValue(value) === "";
}
