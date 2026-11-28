import { env } from "../../../config/env.js";
import { currentMonthKey, formatBudgetGuardrailMessage } from "../../../domains/budget/budget-status.js";
import { readBudgetStatusRows } from "../../../integrations/google-sheets/budget_sheets.js";
import { GoogleSheetsFinanceDigestRepository } from "../../../integrations/google-sheets/finance-digest.repository.js";
import { getFinanceDigest } from "../../../usecases/finance-digest/get-finance-digest.js";
import { formatFinanceDigest } from "../../../usecases/finance-digest/format-finance-digest.js";
import { processCicilanAssistant } from "../../../usecases/cicilan-assistant/process-cicilan-assistant.js";
import { handleCicilanConfirmation } from "../../../usecases/cicilan-assistant/handle-cicilan-confirmation.js";
import { buildWealthSnapshotFromText } from "../../../domains/wealth/wealth-parser.js";
import { formatWealthConfirmationPreview } from "../../../domains/wealth/wealth-formatting.js";
import { savePendingWealthConfirmation } from "../../../usecases/wealth-assistant/wealth-confirmation-store.js";
import { handleWealthConfirmation } from "../../../usecases/wealth-assistant/handle-wealth-confirmation.js";

export async function budgetStatus() {
  const rows = await readBudgetStatusRows();
  const month = currentMonthKey(new Date(), env.TZ);
  return { month, rows: rows.filter((row) => row.month_key === month), message: formatBudgetGuardrailMessage(rows, month) };
}

export async function financeDigest() {
  const digest = await getFinanceDigest(new GoogleSheetsFinanceDigestRepository(), {
    timezone: env.FINANCE_DIGEST_TIMEZONE,
    lookaheadDays: env.FINANCE_DIGEST_LOOKAHEAD_DAYS
  });
  return { digest, message: formatFinanceDigest(digest) };
}

export async function previewCicilan(text: string, id: string) {
  return processCicilanAssistant({ sourcePlatform: "mcp", chatId: "mcp", baseMessageId: id, receivedAt: new Date().toISOString(), text });
}

export async function confirmCicilan(token: string) {
  return handleCicilanConfirmation({ decision: "confirm", token });
}

export function previewWealth(text: string, id: string) {
  const payload = buildWealthSnapshotFromText({ sourcePlatform: "mcp", chatId: "mcp", messageId: id, receivedAt: new Date().toISOString(), text });
  const token = savePendingWealthConfirmation(payload, env.RECEIPT_CONFIRMATION_TTL_MS);
  return { token, preview: formatWealthConfirmationPreview(payload), platform: payload.platform };
}

export async function confirmWealth(token: string) {
  return handleWealthConfirmation({ decision: "confirm", token });
}

export async function wealthImage(input: {
  media_base64: string;
  mime_type: string;
  caption?: string;
  idempotency_key: string;
}) {
  const { processWealthMedia } = await import("../../../usecases/wealth-assistant/process-wealth-media.js");
  return processWealthMedia({
    mediaBase64: input.media_base64,
    mimeType: input.mime_type,
    caption: input.caption,
    idempotencyKey: input.idempotency_key
  });
}

export async function wishlistCommand(input: { text: string; chat_id: string; source_platform?: string }) {
  const { processWishlistAssistant } = await import("../../../usecases/wishlist-assistant/process-wishlist-assistant.js");
  const result = await processWishlistAssistant({
    text: input.text,
    chatId: input.chat_id,
    sourcePlatform: input.source_platform ?? "whatsapp"
  });
  return { messages: result.messages, message: result.messages.join("\n") };
}

export async function modelHealth() {
  const { checkReceiptModelHealth, formatReceiptModelHealthMessage } = await import(
    "../../../usecases/model-health/check-mistral-health.js"
  );
  const result = await checkReceiptModelHealth();
  return { result, message: formatReceiptModelHealthMessage(result) };
}
