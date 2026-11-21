export function normalizeReceiptDate(rawDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;

  const parts = rawDate.replace(/[./]/g, "-").split("-");
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 2 && c.length === 4) {
      return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
  }

  return rawDate;
}

export function buildMonthKey(receiptDate: string): string {
  return receiptDate.slice(0, 7);
}
