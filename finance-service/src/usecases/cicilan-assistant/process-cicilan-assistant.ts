import { env } from "../../config/env.js";
import { formatCicilanConfirmationPreview, formatCicilanFailureMessage } from "../../domains/cicilan/cicilan-formatting.js";
import { buildCicilanPayload } from "../../domains/cicilan/cicilan-parser.js";
import { getReceiptPaymentMethods } from "../../domains/receipts/receipt-payment-method.js";
import { savePendingCicilanConfirmation } from "./cicilan-confirmation-store.js";

export type ProcessCicilanAssistantInput = {
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  text: string;
};

export type CicilanConfirmationRequest = {
  token: string;
  previewText: string;
  paymentMethod: string;
  paymentMethodOptions: string[];
};

export type ProcessCicilanAssistantResult = {
  handled: boolean;
  messages: string[];
  confirmations: CicilanConfirmationRequest[];
};

export async function processCicilanAssistant(
  input: ProcessCicilanAssistantInput
): Promise<ProcessCicilanAssistantResult> {
  try {
    const payload = buildCicilanPayload({
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId,
      messageId: input.baseMessageId,
      receivedAt: input.receivedAt,
      text: input.text
    });
    const token = savePendingCicilanConfirmation(payload, env.RECEIPT_CONFIRMATION_TTL_MS);

    return {
      handled: true,
      messages: [],
      confirmations: [
        {
          token,
          previewText: formatCicilanConfirmationPreview(payload),
          paymentMethod: payload.payment_method,
          paymentMethodOptions: getReceiptPaymentMethods()
        }
      ]
    };
  } catch (error) {
    return {
      handled: true,
      messages: [formatCicilanFailureMessage(error)],
      confirmations: []
    };
  }
}
