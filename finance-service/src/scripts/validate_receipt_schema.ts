import { ReceiptPayloadSchema } from "../domains/receipts/receipt.schema.js";

const sample = {
  schema_version: "receipt.v1.1",
  receipt_id: "123456789:98765",
  source: {
    platform: "telegram",
    chat_id: "123456789",
    message_id: "98765",
    received_at: new Date().toISOString()
  },
  merchant_name: "ALFAMART",
  receipt_date: "2026-04-07",
  total_amount: 25000,
  tax_amount: 2500,
  payment_method: "cc-bca",
  tax_label_raw: "PPN",
  classification: "groceries",
  currency: "IDR",
  month_key: "2026-04",
  confidence: 0.91,
  needs_review: false,
  raw_json: {}
};

ReceiptPayloadSchema.parse(sample);
console.log("receipt.v1.1 schema validation passed");
