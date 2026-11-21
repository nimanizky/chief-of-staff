import type { FinanceDigest } from "../../domains/finance/finance-digest.js";

const MAX_UPCOMING_PAYMENTS = 10;

export function formatFinanceDigest(digest: FinanceDigest): string {
  if (digest.unavailable) {
    return "Finance summary is unavailable; no data was changed.";
  }

  const lines = [`Finance summary - ${formatDate(digest.localDate)}`, "", "This week's card spend"];

  if (digest.weeklySpend.length === 0) {
    lines.push("- No card or paylater spending found.");
  } else {
    for (const row of digest.weeklySpend) {
      lines.push(`- ${row.paymentMethod}: ${formatRupiah(row.amountSpent)}`);
    }
  }
  lines.push(`Total to reserve: ${formatRupiah(digest.totalToReserve)}`);

  lines.push("", "Upcoming payments");
  if (digest.upcomingPayments.length === 0) {
    lines.push("- No payments due in the lookahead window.");
  } else {
    for (const row of digest.upcomingPayments.slice(0, MAX_UPCOMING_PAYMENTS)) {
      lines.push(`- ${row.paymentMethod}: ${formatRupiah(row.amountDue)} due ${formatDate(row.dueDate)}`);
    }
    if (digest.upcomingPayments.length > MAX_UPCOMING_PAYMENTS) {
      lines.push(`- ${digest.upcomingPayments.length - MAX_UPCOMING_PAYMENTS} more payment(s).`);
    }
  }

  if (digest.warnings.length > 0) {
    lines.push("", digest.partial ? "Needs attention - partial data" : "Needs attention");
    for (const warning of digest.warnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

export function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
