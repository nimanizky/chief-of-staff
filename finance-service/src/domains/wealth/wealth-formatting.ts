import type { WealthSnapshotPayload } from "./wealth.schema.js";

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

export function wealthRowValues(payload: WealthSnapshotPayload, rawJsonMax: number): Array<[string, string, string]> {
  return [
    ["A", "snapshot_id", payload.snapshot_id],
    ["B", "message_id", payload.source.message_id],
    ["C", "uploaded_at", payload.uploaded_at],
    ["D", "snapshot_date", payload.snapshot_date],
    ["E", "month_key", payload.month_key],
    ["F", "platform", payload.platform || "unknown"],
    ["G", "account_name", payload.account_name],
    ["H", "asset_type", payload.asset_type],
    ["I", "amount", payload.amount.toString()],
    ["J", "currency", payload.currency],
    ["K", "source_type", payload.source_type],
    ["L", "confidence", payload.confidence.toString()],
    ["M", "raw_json", truncateText(JSON.stringify(payload.raw_json), rawJsonMax)]
  ];
}

export function formatWealthTable(payload: WealthSnapshotPayload, rawJsonMax: number): string {
  const rows = wealthRowValues(payload, rawJsonMax)
    .map(([col, header, value]) => `| ${col} | \`${header}\` | ${tableCell(value, col === "M" ? rawJsonMax : 240)} |`)
    .join("\n");

  return `| Col | Header | Value |
| --- | --- | --- |
${rows}`;
}

export function formatWealthConfirmationPreview(payload: WealthSnapshotPayload): string {
  return `Parsed wealth snapshot (not saved yet)

platform: ${payload.platform || "unknown"}
account_name: ${payload.account_name || "unknown"}
asset_type: ${payload.asset_type}
amount: ${payload.amount}
month_key: ${payload.month_key}
source_type: ${payload.source_type}

${formatWealthTable(payload, 320)}

Save this wealth snapshot?`;
}

export function formatWealthFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/amount/i.test(message)) {
    return "Could not find a wealth amount. Example: wealth jago 15.2jt cash.";
  }
  if (/platform/i.test(message)) {
    return "Could not identify the platform. Add a caption like: wealth jago, wealth stockbit, wealth bibit.";
  }
  return "Wealth snapshot processing failed. Retry with platform and amount, or upload a clearer statement.";
}
