import {
  appendReceiptsRawRow,
  type AppendReceiptResult
} from "../../integrations/google-sheets/append_receipt_row.js";
import { ensureMonthlyBreakdownV2Formulas } from "../../integrations/google-sheets/ensure_monthly_breakdown_v2_formula.js";
import { ensureMonthlyBreakdownFormula } from "../../integrations/google-sheets/ensure_monthly_formula.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { logReceiptOutcome } from "../../observability/receipt_logger.js";

export type SaveReceiptRowInput = {
  payload: ReceiptPayload;
};

export type SaveReceiptRowResult = {
  status: AppendReceiptResult;
};

export async function saveReceiptRow(input: SaveReceiptRowInput): Promise<SaveReceiptRowResult> {
  return {
    status: await persistReceiptPayload(input.payload)
  };
}

export async function persistReceiptPayload(payload: ReceiptPayload): Promise<AppendReceiptResult> {
  const appendResult = await appendReceiptsRawRow(payload);
  await ensureMonthlyBreakdownFormula();
  await ensureMonthlyBreakdownV2Formulas();

  logReceiptOutcome({
    receipt_id: payload.receipt_id,
    outcome: appendResult,
    merchant_name: payload.merchant_name,
    receipt_date: payload.receipt_date,
    classification: payload.classification,
    confidence: payload.confidence,
    needs_review: payload.needs_review
  });

  return appendResult;
}
