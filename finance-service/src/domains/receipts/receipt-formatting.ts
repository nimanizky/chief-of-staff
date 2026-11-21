import type { ReceiptPayload } from "./receipt.schema.js";
import { ReceiptError } from "../../errors/receipt_errors.js";

const MARKDOWN_TABLE_LINE_BREAK_PATTERN = /\r?\n/g;
const MARKDOWN_TABLE_PIPE_PATTERN = /\|/g;

export function prefixReceiptLabel(
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const parts: string[] = [];
  if (totalMedia > 1) parts.push(`Attachment ${mediaIndex + 1}/${totalMedia}`);
  if (totalPages > 1) parts.push(`Page ${pageNumber}/${totalPages}`);
  if (parts.length === 0) return "";
  return `[${parts.join(" · ")}] `;
}

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

export function receiptRowValues(payload: ReceiptPayload, rawJsonMax: number): Array<[string, string, string]> {
  return [
    ["A", "receipt_id", payload.receipt_id],
    ["B", "message_id", payload.source.message_id],
    ["C", "merchant_name", payload.merchant_name],
    ["D", "receipt_date", payload.receipt_date],
    ["E", "total_amount", payload.total_amount.toString()],
    ["F", "tax_amount", payload.tax_amount.toString()],
    ["G", "payment_method", payload.payment_method || "unknown"],
    ["H", "classification", payload.classification],
    ["I", "currency", payload.currency],
    ["J", "confidence", payload.confidence.toString()],
    ["K", "needs_review", payload.needs_review ? "TRUE" : "FALSE"],
    ["L", "tax_label_raw", payload.tax_label_raw],
    ["M", "month_key", payload.month_key],
    ["N", "raw_json", truncateText(JSON.stringify(payload.raw_json), rawJsonMax)]
  ];
}

export function formatReceiptTable(payload: ReceiptPayload, rawJsonMax: number): string {
  const rows = receiptRowValues(payload, rawJsonMax)
    .map(([col, header, value]) => `| ${col} | \`${header}\` | ${tableCell(value, col === "N" ? rawJsonMax : 240)} |`)
    .join("\n");

  return `| Col | Header | Value |
| --- | --- | --- |
${rows}`;
}

export function formatReceiptConfirmationPreview(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixReceiptLabel(mediaIndex, totalMedia, pageNumber, totalPages);
  const isIncome = payload.classification === "income";
  const label = isIncome ? "income record" : "receipt";
  return `${prefix}Parsed ${label} (not saved yet)

${formatReceiptTable(payload, 320)}

Save this ${label} to enabled destinations?`;
}

export function formatReceiptFailureMessage(error: unknown, mediaIndex: number, totalMedia: number): string {
  const prefix = prefixReceiptLabel(mediaIndex, totalMedia, 1, 1);

  if (error instanceof ReceiptError) {
    if (error.code === "UNSUPPORTED_MEDIA") {
      return `${prefix}Unsupported file type. Send receipt media, or use /income with media for income.`;
    }
    if (error.code === "PDF_DISABLED") {
      return `${prefix}PDF intake is currently disabled. Send an image receipt, or use /income with an image for income.`;
    }
    if (error.code === "PDF_CONVERSION") {
      return `${prefix}Could not process PDF. Install poppler-utils (pdftoppm/pdfinfo) on the gateway host.`;
    }
    if (error.code === "MODEL_TEMPORARY") {
      return `${prefix}Temporary parsing error from model provider. Retry in a minute.`;
    }
    if (error.code === "MODEL_PERMANENT") {
      return `${prefix}Could not parse receipt reliably; marked for review.`;
    }
    if (error.code === "SHEETS_READ" || error.code === "SHEETS_WRITE") {
      return `${prefix}Could not save to sheet; check Google Sheets configuration and permissions.`;
    }
    if (error.code === "MEDIA_FETCH") {
      if (error.status === 413) {
        return `${prefix}File is too large for processing. Send a smaller image/PDF.`;
      }
      return `${prefix}Could not download attachment.`;
    }
  }

  return `${prefix}Receipt processing failed. Please retry.`;
}
