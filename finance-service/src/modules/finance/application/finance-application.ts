import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { receiptClassifications } from "../../../domains/receipts/receipt-classification.js";
import { ReceiptPayloadSchema, type ReceiptPayload } from "../../../domains/receipts/receipt.schema.js";
import type { ConfirmedReceiptSaveResult } from "../../../usecases/receipt-assistant/save-confirmed-receipt.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const FinanceReceiptInputSchema = z.object({
  idempotency_key: z.string().min(8).max(128).regex(IDEMPOTENCY_KEY_PATTERN),
  merchant_name: z.string().trim().min(1).max(160),
  receipt_date: z.string().regex(ISO_DATE_PATTERN).refine(isValidIsoDate, "Must be a real calendar date in YYYY-MM-DD format."),
  total_amount: z.number().finite().min(0),
  tax_amount: z.number().finite().min(0).default(0),
  payment_method: z.string().trim().min(1).max(80),
  tax_label_raw: z.string().max(120).default(""),
  classification: z.enum(receiptClassifications),
  currency: z.string().regex(/^[A-Z]{3}$/).default("IDR"),
  confidence: z.number().finite().min(0).max(1)
}).strict();

export const FinanceReceiptRecordInputSchema = FinanceReceiptInputSchema.extend({
  user_confirmed: z.literal(true)
}).strict();

export type FinanceReceiptInput = z.infer<typeof FinanceReceiptInputSchema>;
export type FinanceReceiptRecordInput = z.infer<typeof FinanceReceiptRecordInputSchema>;
export type FinanceIntakeChannel = "http_api" | "mcp";

export type FinanceReceiptPreview = {
  receipt_id: string;
  merchant_name: string;
  receipt_date: string;
  total_amount: number;
  tax_amount: number;
  payment_method: string;
  classification: ReceiptPayload["classification"];
  currency: string;
  confidence: number;
  needs_review: boolean;
  review_reason?: string;
  writes_data: false;
};

export type FinanceReceiptRecordResult = {
  receipt_id: string;
  storage_status: "saved" | "duplicate";
  sheet_sync_status: ConfirmedReceiptSaveResult["sheets"]["status"];
  journal_status: ConfirmedReceiptSaveResult["journal"]["status"];
  needs_review: boolean;
  partial: boolean;
};

export type FinanceApplication = {
  paymentMethods: readonly string[];
  previewReceipt(input: unknown, channel: FinanceIntakeChannel): FinanceReceiptPreview;
  recordReceipt(input: unknown, channel: FinanceIntakeChannel): Promise<FinanceReceiptRecordResult>;
  recordConfirmedReceipt(payload: ReceiptPayload): Promise<ConfirmedReceiptSaveResult>;
};

export type FinanceApplicationDependencies = {
  paymentMethods: readonly string[];
  saveConfirmedReceipt(payload: ReceiptPayload): Promise<ConfirmedReceiptSaveResult>;
  now?: () => Date;
};

export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceValidationError";
  }
}

export class FinancePersistenceError extends Error {
  constructor() {
    super("Finance data could not be saved to the canonical SQLite store.");
    this.name = "FinancePersistenceError";
  }
}

export function createFinanceApplication(dependencies: FinanceApplicationDependencies): FinanceApplication {
  const paymentMethods = [...new Set(dependencies.paymentMethods)];
  if (paymentMethods.length === 0) {
    throw new Error("Finance application requires at least one configured payment method.");
  }

  const now = dependencies.now ?? (() => new Date());

  function prepareReceipt(input: unknown, channel: FinanceIntakeChannel): ReceiptPayload {
    const parsed = FinanceReceiptInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new FinanceValidationError(formatValidationIssues(parsed.error));
    }

    if (!paymentMethods.includes(parsed.data.payment_method)) {
      throw new FinanceValidationError(
        "Unsupported payment_method. Allowed values: " + paymentMethods.join(", ")
      );
    }

    const payload = ReceiptPayloadSchema.parse({
      schema_version: "receipt.v1.1",
      receipt_id: buildReceiptId(parsed.data.idempotency_key),
      source: {
        platform: channel === "mcp" ? "mcp" : "finance_api",
        chat_id: channel,
        message_id: buildReceiptId(parsed.data.idempotency_key),
        received_at: now().toISOString()
      },
      merchant_name: parsed.data.merchant_name,
      receipt_date: parsed.data.receipt_date,
      total_amount: parsed.data.total_amount,
      tax_amount: parsed.data.tax_amount,
      payment_method: parsed.data.payment_method,
      tax_label_raw: parsed.data.tax_label_raw,
      classification: parsed.data.classification,
      currency: parsed.data.currency,
      month_key: parsed.data.receipt_date.slice(0, 7),
      confidence: parsed.data.confidence,
      needs_review: parsed.data.confidence < 0.8,
      raw_json: {
        intake_channel: channel,
        parser: channel === "mcp" ? "structured_client" : "external_client"
      }
    });

    return payload;
  }

  async function writePayload(payload: ReceiptPayload): Promise<FinanceReceiptRecordResult> {
    const validatedPayload = ReceiptPayloadSchema.parse(payload);
    let saveResult: ConfirmedReceiptSaveResult;
    try {
      saveResult = await dependencies.saveConfirmedReceipt(validatedPayload);
    } catch {
      throw new FinancePersistenceError();
    }
    if (saveResult.sqlite.status !== "saved" && saveResult.sqlite.status !== "duplicate") {
      throw new FinancePersistenceError();
    }

    const partial = Object.values(saveResult).some((sink) => sink.enabled && sink.status === "failed");
    return {
      receipt_id: validatedPayload.receipt_id,
      storage_status: saveResult.sqlite.status,
      sheet_sync_status: saveResult.sheets.status,
      journal_status: saveResult.journal.status,
      needs_review: validatedPayload.needs_review,
      partial
    };
  }

  return {
    paymentMethods,

    previewReceipt(input, channel) {
      const payload = prepareReceipt(input, channel);
      const needsReview = payload.needs_review;
      return {
        receipt_id: payload.receipt_id,
        merchant_name: payload.merchant_name,
        receipt_date: payload.receipt_date,
        total_amount: payload.total_amount,
        tax_amount: payload.tax_amount,
        payment_method: payload.payment_method,
        classification: payload.classification,
        currency: payload.currency,
        confidence: payload.confidence,
        needs_review: needsReview,
        ...(needsReview ? { review_reason: "Parser confidence is below 0.8." } : {}),
        writes_data: false
      };
    },

    async recordReceipt(input, channel) {
      const parsed = FinanceReceiptRecordInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new FinanceValidationError(formatValidationIssues(parsed.error));
      }
      const { user_confirmed: _userConfirmed, ...receiptFields } = parsed.data;
      const payload = prepareReceipt(receiptFields, channel);
      return writePayload(payload);
    },

    async recordConfirmedReceipt(payload) {
      return dependencies.saveConfirmedReceipt(ReceiptPayloadSchema.parse(payload));
    }
  };
}

function buildReceiptId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return "external:" + digest;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
      return path + issue.message;
    })
    .join("; ");
}
