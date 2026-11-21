import type { CicilanPayload } from "./cicilan.schema.js";

const MARKDOWN_TABLE_LINE_BREAK_PATTERN = /\r?\n/g;
const MARKDOWN_TABLE_PIPE_PATTERN = /\|/g;

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function tableCell(value: unknown, max = 240): string {
  const text = value === undefined || value === null ? "" : String(value);
  return truncateText(text, max)
    .replace(MARKDOWN_TABLE_LINE_BREAK_PATTERN, " ")
    .replace(MARKDOWN_TABLE_PIPE_PATTERN, "\\|")
    .trim();
}

export function projectedMonthlyAmount(payload: CicilanPayload): number {
  return Math.round(payload.total_amount / payload.tenor_months);
}

export function cicilanRowValues(payload: CicilanPayload, rawJsonMax: number): Array<[string, string, string]> {
  return [
    ["A", "cicilan_id", payload.cicilan_id],
    ["B", "message_id", payload.source.message_id],
    ["C", "merchant_name", payload.merchant_name],
    ["D", "cicilan_date", payload.cicilan_date],
    ["E", "total_amount", payload.total_amount.toString()],
    ["F", "payment_method", payload.payment_method || "unknown"],
    ["G", "classification", payload.classification],
    ["H", "confidence", payload.confidence.toString()],
    ["I", "tenor_months", payload.tenor_months.toString()],
    ["J", "month_key", payload.month_key],
    ["K", "raw_json", truncateText(JSON.stringify(payload.raw_json), rawJsonMax)]
  ];
}

export function formatCicilanTable(payload: CicilanPayload, rawJsonMax: number): string {
  const rows = cicilanRowValues(payload, rawJsonMax)
    .map(([col, header, value]) => `| ${col} | \`${header}\` | ${tableCell(value, col === "K" ? rawJsonMax : 240)} |`)
    .join("\n");

  return `| Col | Header | Value |
| --- | --- | --- |
${rows}`;
}

export function formatCicilanConfirmationPreview(payload: CicilanPayload): string {
  return `Parsed cicilan (not saved yet)

merchant_name: ${payload.merchant_name}
total_amount: ${payload.total_amount}
tenor_months: ${payload.tenor_months}
projected_monthly_amount: ${projectedMonthlyAmount(payload)}
payment_method: ${payload.payment_method || "unknown"}
month_key: ${payload.month_key}

${formatCicilanTable(payload, 320)}

Save this cicilan plan?`;
}

export function formatCicilanFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/amount/i.test(message)) return "Could not find a cicilan amount. Example: cicilan cc bca uniqlo 5090234 12 bulan.";
  return "Cicilan processing failed. Please retry with amount, merchant, and optional tenor.";
}
