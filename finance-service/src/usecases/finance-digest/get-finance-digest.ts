import type {
  FinanceDigest,
  FinanceDigestOptions,
  FinanceDigestRepository,
  FinanceSourceResult,
  PaymentCalendarRow,
  ReceiptQualityRow,
  WeeklySpendRow
} from "../../domains/finance/finance-digest.js";

const SOURCE_FAILURE_MESSAGES = {
  weekly: "Weekly spend data is unavailable.",
  calendar: "Payment calendar data is unavailable.",
  receipts: "Receipt quality data is unavailable."
} as const;

export async function getFinanceDigest(
  repository: FinanceDigestRepository,
  options: FinanceDigestOptions
): Promise<FinanceDigest> {
  const now = options.now ?? new Date();
  const localDate = dateInTimezone(now, options.timezone);
  const lookaheadEnd = addDays(localDate, options.lookaheadDays);

  const [weeklyResult, calendarResult, receiptResult] = await Promise.allSettled([
    repository.readWeeklySpend(),
    repository.readPaymentCalendar(),
    repository.readReceiptQuality()
  ]);

  const warnings: string[] = [];
  let availableSources = 0;

  const weekly = settledSource(weeklyResult, SOURCE_FAILURE_MESSAGES.weekly, warnings);
  if (weekly) availableSources += 1;
  const calendar = settledSource(calendarResult, SOURCE_FAILURE_MESSAGES.calendar, warnings);
  if (calendar) availableSources += 1;
  const receipts = settledSource(receiptResult, SOURCE_FAILURE_MESSAGES.receipts, warnings);
  if (receipts) availableSources += 1;

  const weeklySpend = summarizeWeeklySpend(weekly?.rows ?? [], localDate);
  const upcomingPayments = selectUpcomingPayments(
    calendar?.rows ?? [],
    localDate,
    lookaheadEnd,
    warnings
  );
  addReceiptWarnings(receipts?.rows ?? [], localDate, warnings);

  return {
    generatedAt: now.toISOString(),
    localDate,
    weeklySpend,
    totalToReserve: weeklySpend.reduce((total, row) => total + row.amountSpent, 0),
    upcomingPayments,
    warnings: unique(warnings),
    partial: availableSources > 0 && availableSources < 3,
    unavailable: availableSources === 0
  };
}

function settledSource<T>(
  result: PromiseSettledResult<FinanceSourceResult<T>>,
  failureMessage: string,
  warnings: string[]
): FinanceSourceResult<T> | null {
  if (result.status === "rejected") {
    warnings.push(failureMessage);
    return null;
  }
  warnings.push(...result.value.warnings);
  return result.value;
}

function summarizeWeeklySpend(
  rows: WeeklySpendRow[],
  localDate: string
): FinanceDigest["weeklySpend"] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.weekStart > localDate || row.weekEnd < localDate || !row.paymentMethod) continue;
    totals.set(row.paymentMethod, (totals.get(row.paymentMethod) ?? 0) + row.amountSpent);
  }

  return [...totals.entries()]
    .filter(([, amountSpent]) => amountSpent > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([paymentMethod, amountSpent]) => ({ paymentMethod, amountSpent }));
}

function selectUpcomingPayments(
  rows: PaymentCalendarRow[],
  localDate: string,
  lookaheadEnd: string,
  warnings: string[]
): PaymentCalendarRow[] {
  const overdueCount = rows.filter((row) => row.dueDate < localDate).length;
  if (overdueCount > 0) {
    warnings.push(
      `${overdueCount} payment calendar date${overdueCount === 1 ? " has" : "s have"} passed; payment status is not tracked.`
    );
  }

  return rows
    .filter((row) => row.dueDate >= localDate && row.dueDate <= lookaheadEnd)
    .sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) ||
        left.paymentMethod.localeCompare(right.paymentMethod)
    );
}

function addReceiptWarnings(rows: ReceiptQualityRow[], localDate: string, warnings: string[]): void {
  const month = localDate.slice(0, 7);
  const currentRows = rows.filter((row) => row.receiptDate.startsWith(month));
  const needsReview = currentRows.filter((row) => row.needsReview).length;
  const missingMethod = currentRows.filter((row) => !row.paymentMethod).length;

  if (needsReview > 0) {
    warnings.push(`${needsReview} receipt${needsReview === 1 ? " needs" : "s need"} review.`);
  }
  if (missingMethod > 0) {
    warnings.push(
      `${missingMethod} receipt${missingMethod === 1 ? " has" : "s have"} no payment method.`
    );
  }
}

export function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
