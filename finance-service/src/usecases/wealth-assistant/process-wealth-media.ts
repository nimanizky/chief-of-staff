import { env } from "../../config/env.js";
import { formatWealthConfirmationPreview } from "../../domains/wealth/wealth-formatting.js";
import { buildWealthSnapshotFromCandidate } from "../../domains/wealth/wealth-parser.js";
import { getWealthPlatforms } from "../../domains/wealth/wealth-platform.js";
import { ReceiptError } from "../../errors/receipt_errors.js";
import { extractWealthSnapshotFromImage } from "../../integrations/models/mistral-wealth-parser.adapter.js";
import { rasterizePdfBufferToJpegPages } from "../../media/pdf_rasterizer.js";
import { savePendingWealthConfirmation } from "./wealth-confirmation-store.js";

export type ProcessWealthMediaInput = {
  /** Base64-encoded image or PDF bytes, without a data: prefix. */
  mediaBase64: string;
  mimeType: string;
  /** Optional caption that gives the parser extra context (platform hints, totals). */
  caption?: string;
  /** Stable id from the caller, used to build the snapshot's message id. */
  idempotencyKey: string;
  sourcePlatform?: string;
  chatId?: string;
  receivedAt?: string;
};

export type ProcessWealthMediaResult = {
  token: string;
  preview: string;
  platform: string;
  platformOptions: string[];
  notes: string[];
};

/**
 * Parses a wealth snapshot out of an image or single-page PDF and queues it for
 * explicit confirmation. Nothing is written to Google Sheets here: the caller
 * must confirm the returned token.
 */
export async function processWealthMedia(input: ProcessWealthMediaInput): Promise<ProcessWealthMediaResult> {
  const mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  if (!isPdf && !isImage) {
    throw new ReceiptError("UNSUPPORTED_MEDIA", `Unsupported wealth media type: ${mimeType}`);
  }
  if (isPdf && (env.RECEIPT_STRICT_MEMORY_ONLY || !env.RECEIPT_ACCEPT_PDF)) {
    throw new ReceiptError("PDF_DISABLED", "PDF parsing is disabled.");
  }

  const binary = Buffer.from(input.mediaBase64, "base64");
  if (binary.length === 0) {
    throw new ReceiptError("UNSUPPORTED_MEDIA", "Wealth media payload was empty or not valid base64.");
  }

  const caption = input.caption?.trim() || undefined;
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const sourcePlatform = input.sourcePlatform ?? "mcp";
  const chatId = input.chatId ?? "mcp";
  const notes: string[] = [];

  if (isPdf) {
    const pages = await rasterizePdfBufferToJpegPages(binary, 1);
    const firstPage = pages[0];
    if (!firstPage) {
      throw new ReceiptError("PDF_CONVERSION", "PDF was converted, but no pages were produced.");
    }
    if (firstPage.truncated) {
      notes.push("Processed the first PDF page only for this wealth snapshot.");
    }

    const candidate = await extractWealthSnapshotFromImage(firstPage.imageBase64, firstPage.mimeType, caption);
    return queue(
      buildWealthSnapshotFromCandidate({
        sourcePlatform,
        chatId,
        messageId: `${input.idempotencyKey}:p${firstPage.pageNumber}`,
        receivedAt,
        candidate,
        captionText: caption,
        sourceType: "pdf",
        pdfPageNumber: firstPage.pageNumber,
        pdfTotalPages: firstPage.totalPages,
        pdfTruncated: firstPage.truncated
      }),
      notes
    );
  }

  const candidate = await extractWealthSnapshotFromImage(binary.toString("base64"), mimeType, caption);
  return queue(
    buildWealthSnapshotFromCandidate({
      sourcePlatform,
      chatId,
      messageId: input.idempotencyKey,
      receivedAt,
      candidate,
      captionText: caption,
      sourceType: "image"
    }),
    notes
  );
}

function queue(
  payload: ReturnType<typeof buildWealthSnapshotFromCandidate>,
  notes: string[]
): ProcessWealthMediaResult {
  const token = savePendingWealthConfirmation(payload, env.RECEIPT_CONFIRMATION_TTL_MS);
  return {
    token,
    preview: formatWealthConfirmationPreview(payload),
    platform: payload.platform,
    platformOptions: getWealthPlatforms(),
    notes
  };
}
