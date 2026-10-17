import { env } from "../../config/env.js";
import { formatReceiptFailureMessage, prefixReceiptLabel } from "../../domains/receipts/receipt-formatting.js";
import { isReceiptPaymentMethod } from "../../domains/receipts/receipt-payment-method.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { financeApplication } from "../../modules/finance/finance-runtime.js";
import type { ConfirmationAction } from "./receipt-confirmation-store.js";
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  prunePendingConfirmations
} from "./receipt-confirmation-store.js";
import {
  formatConfirmedReceiptSaveMessage,
  hasFailedEnabledSink,
} from "./save-confirmed-receipt.js";

export type ReceiptConfirmationResult = {
  handled: boolean;
  message?: string;
};

export async function handleReceiptConfirmation(action: ConfirmationAction): Promise<ReceiptConfirmationResult> {
  prunePendingConfirmations(env.RECEIPT_CONFIRMATION_TTL_MS);

  const pending = getPendingConfirmation(action.token);
  if (!pending) {
    return {
      handled: true,
      message: "Receipt confirmation token is missing or expired. Re-send the media to parse again."
    };
  }

  if (action.decision === "reject") {
    deletePendingConfirmation(action.token);
    const prefix = prefixReceiptLabel(
      pending.mediaIndex,
      pending.totalMedia,
      pending.pageNumber,
      pending.totalPages
    );
    return {
      handled: true,
      message: `${prefix}No changes made. Receipt was not saved.`
    };
  }

  if (action.decision === "method" && !isReceiptPaymentMethod(action.paymentMethod)) {
    return {
      handled: true,
      message: `Unknown payment method: ${action.paymentMethod}. Re-send the media or choose one of the listed buttons.`
    };
  }

  const payload =
    action.decision === "method"
      ? withPaymentMethod(pending.payload, action.paymentMethod)
      : pending.payload;

  if (action.decision === "confirm" && !payload.payment_method) {
    return {
      handled: true,
      message: "Choose a payment method first, or tap No to reject this receipt."
    };
  }

  try {
    const result = await financeApplication.recordConfirmedReceipt(payload);
    const prefix = prefixReceiptLabel(
      pending.mediaIndex,
      pending.totalMedia,
      pending.pageNumber,
      pending.totalPages
    );
    if (!hasFailedEnabledSink(result)) {
      deletePendingConfirmation(action.token);
    }
    return {
      handled: true,
      message: formatConfirmedReceiptSaveMessage(result, payload.receipt_id, prefix)
    };
  } catch (error) {
    return {
      handled: true,
      message: formatReceiptFailureMessage(error, pending.mediaIndex, pending.totalMedia)
    };
  }
}

function withPaymentMethod(payload: ReceiptPayload, paymentMethod: string): ReceiptPayload {
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
