import type { ReceiptPayload } from "./receipt.schema.js";

export const RECEIPT_RAW_COLUMNS = [
  "receipt_id",
  "message_id",
  "merchant_name",
  "receipt_date",
  "total_amount",
  "tax_amount",
  "payment_method",
  "classification",
  "currency",
  "confidence",
  "needs_review",
  "tax_label_raw",
  "month_key",
  "raw_json"
] as const;

export type ReceiptRawRecord = {
  receipt_id: string;
  message_id: string;
  merchant_name: string;
  receipt_date: string;
  total_amount: number;
  tax_amount: number;
  payment_method: string;
  classification: string;
  currency: string;
  confidence: number;
  needs_review: boolean;
  tax_label_raw: string;
  month_key: string;
  raw_json: string;
};

export type ReceiptRawRow = [
  string,
  string,
  string,
  string,
  number,
  number,
  string,
  string,
  string,
  number,
  boolean,
  string,
  string,
  string
];

export function toReceiptRawRecord(payload: ReceiptPayload): ReceiptRawRecord {
  return {
    receipt_id: payload.receipt_id,
    message_id: payload.source.message_id,
    merchant_name: payload.merchant_name,
    receipt_date: payload.receipt_date,
    total_amount: payload.total_amount,
    tax_amount: payload.tax_amount,
    payment_method: payload.payment_method,
    classification: payload.classification,
    currency: payload.currency,
    confidence: payload.confidence,
    needs_review: payload.needs_review,
    tax_label_raw: payload.tax_label_raw,
    month_key: payload.month_key,
    raw_json: JSON.stringify(payload.raw_json)
  };
}

export function toReceiptRawRow(payload: ReceiptPayload): ReceiptRawRow {
  const record = toReceiptRawRecord(payload);
  return RECEIPT_RAW_COLUMNS.map((column) => record[column]) as ReceiptRawRow;
}
