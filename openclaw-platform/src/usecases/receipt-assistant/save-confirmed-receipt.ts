import { env } from "../../config/env.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { ReceiptError } from "../../errors/receipt_errors.js";
import { prependReceiptJournalEntry } from "../../integrations/spreadsheets/receipt-journal.adapter.js";
import { saveReceiptToSqlite } from "../../integrations/sqlite/receipt-store.js";

export type SinkSaveStatus = "saved" | "duplicate" | "queued" | "skipped" | "failed";

export type SinkSaveResult = {
  enabled: boolean;
  status: SinkSaveStatus;
  error?: unknown;
};

export type ConfirmedReceiptSaveResult = {
  sqlite: SinkSaveResult;
  journal: SinkSaveResult;
  sheets: SinkSaveResult;
};

export async function saveConfirmedReceipt(payload: ReceiptPayload): Promise<ConfirmedReceiptSaveResult> {
  const result: ConfirmedReceiptSaveResult = {
    sqlite: {
      enabled: true,
      status: "failed"
    },
    journal: {
      enabled: env.RECEIPT_SAVE_JOURNAL,
      status: "skipped"
    },
    sheets: {
      enabled: env.RECEIPT_SAVE_SHEETS,
      status: "skipped"
    }
  };

  let canonicalPayload: ReceiptPayload;
  try {
    const stored = saveReceiptToSqlite(payload, env.FINANCE_SQLITE_PATH);
    canonicalPayload = stored.payload;
    result.sqlite.status = stored.status;
    if (env.RECEIPT_SAVE_SHEETS) {
      result.sheets.status = stored.sheetsSyncedAt ? "duplicate" : "queued";
    }
  } catch (error) {
    result.sqlite.error = error;
    logSinkError("sqlite", error);
    if (env.RECEIPT_SAVE_SHEETS) {
      result.sheets.status = "failed";
      result.sheets.error = new Error("Not queued because SQLite did not save the canonical receipt.");
    }
    return result;
  }

  if (env.RECEIPT_SAVE_JOURNAL) {
    try {
      const journalResult = await prependReceiptJournalEntry(canonicalPayload);
      result.journal.status = journalResult === "appended" ? "saved" : "duplicate";
    } catch (error) {
      result.journal.status = "failed";
      result.journal.error = error;
      logSinkError("receipt_journal", error);
    }
  }

  return result;
}

export function hasFailedEnabledSink(result: ConfirmedReceiptSaveResult): boolean {
  return Object.values(result).some((sink) => sink.enabled && sink.status === "failed");
}

export function formatConfirmedReceiptSaveMessage(
  result: ConfirmedReceiptSaveResult,
  receiptId: string,
  prefix: string
): string {
  const lines = [
    `SQLite: ${formatSqliteSinkStatus(result.sqlite)}`,
    `${prefix}Journal: ${formatJournalSinkStatus(result.journal)}`,
    `Google Sheets: ${formatSheetsSinkStatus(result.sheets)}`,
    `Receipt: ${receiptId}`
  ];

  if (hasFailedEnabledSink(result)) {
    lines.push("Some enabled saves failed. You can retry this confirmation.");
  }

  return lines.join("\n");
}

function formatSqliteSinkStatus(result: SinkSaveResult): string {
  if (result.status === "saved") return "Saved as the canonical receipt.";
  if (result.status === "duplicate") return "Already recorded; the original row remains canonical.";
  return `Failed to save. ${formatSinkError(result.error)}`;
}

function formatJournalSinkStatus(result: SinkSaveResult): string {
  if (!result.enabled || result.status === "skipped") return "Skipped by config.";
  if (result.status === "saved") return "Saved to receipt-journal.md.";
  if (result.status === "duplicate") return "Already recorded in receipt-journal.md.";
  return `Failed to save. ${formatSinkError(result.error)}`;
}

function formatSheetsSinkStatus(result: SinkSaveResult): string {
  if (!result.enabled || result.status === "skipped") return "Skipped by config.";
  if (result.status === "saved") return `Saved to ${env.RECEIPT_SHEET_RAW}.`;
  if (result.status === "duplicate") return `Already recorded in ${env.RECEIPT_SHEET_RAW}.`;
  if (result.status === "queued") return `Queued for automatic sync to ${env.RECEIPT_SHEET_RAW}.`;
  return `Failed to save. ${formatSinkError(result.error)}`;
}

function formatSinkError(error: unknown): string {
  const details = sinkErrorDetails(error);
  return details ? details : "Check configuration and permissions.";
}

function logSinkError(sink: string, error: unknown): void {
  console.error(`[receipt-save] ${sink} failed: ${sinkErrorDetails(error)}`);
}

function sinkErrorDetails(error: unknown): string {
  if (error instanceof ReceiptError) {
    const cause = error.cause ? ` Cause: ${externalErrorMessage(error.cause)}` : "";
    const status = error.status ? ` HTTP ${error.status}.` : "";
    return `${error.code}: ${error.message}.${status}${cause}`.trim();
  }
  return externalErrorMessage(error);
}

function externalErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
      response?: { status?: unknown; data?: { error?: unknown; error_description?: unknown } };
    };
    const parts = [
      candidate.code ? `code=${String(candidate.code)}` : "",
      candidate.status ?? candidate.response?.status ? `status=${String(candidate.status ?? candidate.response?.status)}` : "",
      candidate.message ? String(candidate.message) : "",
      candidate.response?.data?.error ? `error=${String(candidate.response.data.error)}` : "",
      candidate.response?.data?.error_description ? String(candidate.response.data.error_description) : ""
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return String(error);
}
