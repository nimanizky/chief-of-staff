import { env } from "../../config/env.js";
import { formatCicilanFailureMessage } from "../../domains/cicilan/cicilan-formatting.js";
import type { CicilanPayload } from "../../domains/cicilan/cicilan.schema.js";
import { isReceiptPaymentMethod } from "../../domains/receipts/receipt-payment-method.js";
import { appendCicilanRawRow } from "../../integrations/google-sheets/append_cicilan_row.js";
import { ensureMonthlyBreakdownV2Formulas } from "../../integrations/google-sheets/ensure_monthly_breakdown_v2_formula.js";
import type { CicilanConfirmationAction } from "./cicilan-confirmation-store.js";
import {
  deletePendingCicilanConfirmation,
  getPendingCicilanConfirmation,
  prunePendingCicilanConfirmations
} from "./cicilan-confirmation-store.js";

export type CicilanConfirmationResult = {
  handled: boolean;
  message?: string;
};

export async function handleCicilanConfirmation(
  action: CicilanConfirmationAction
): Promise<CicilanConfirmationResult> {
  prunePendingCicilanConfirmations(env.RECEIPT_CONFIRMATION_TTL_MS);

  const pending = getPendingCicilanConfirmation(action.token);
  if (!pending) {
    return {
      handled: true,
      message: "Cicilan confirmation token is missing or expired. Re-send the text to parse again."
    };
  }

  if (action.decision === "reject") {
    deletePendingCicilanConfirmation(action.token);
    return {
      handled: true,
      message: "No changes made. Cicilan was not saved."
    };
  }

  if (action.decision === "method" && !isReceiptPaymentMethod(action.paymentMethod)) {
    return {
      handled: true,
      message: `Unknown payment method: ${action.paymentMethod}. Choose one of the listed buttons.`
    };
  }

  const payload =
    action.decision === "method"
      ? withPaymentMethod(pending.payload, action.paymentMethod)
      : pending.payload;

  if (action.decision === "confirm" && !payload.payment_method) {
    return {
      handled: true,
      message: "Choose a payment method first, or tap No to reject this cicilan."
    };
  }

  try {
    const result = await appendCicilanRawRow(payload);
    await ensureMonthlyBreakdownV2Formulas();
    deletePendingCicilanConfirmation(action.token);

    return {
      handled: true,
      message:
        result === "duplicate"
          ? `Already recorded in ${env.CICILAN_SHEET_RAW}.`
          : `Saved to ${env.CICILAN_SHEET_RAW}.`
    };
  } catch (error) {
    return {
      handled: true,
      message: formatCicilanFailureMessage(error)
    };
  }
}

function withPaymentMethod(payload: CicilanPayload, paymentMethod: string): CicilanPayload {
  return {
    ...payload,
    payment_method: paymentMethod,
    raw_json: {
      ...payload.raw_json,
      payment_method_source: "button",
      payment_method_selected: paymentMethod
    }
  };
}
