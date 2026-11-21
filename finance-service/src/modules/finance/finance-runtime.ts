import { getReceiptPaymentMethods } from "../../domains/receipts/receipt-payment-method.js";
import { saveConfirmedReceipt } from "../../usecases/receipt-assistant/save-confirmed-receipt.js";
import { createFinanceApplication } from "./application/finance-application.js";

export const financeApplication = createFinanceApplication({
  paymentMethods: getReceiptPaymentMethods(),
  saveConfirmedReceipt
});
