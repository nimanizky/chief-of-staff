import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimPendingReceiptSheetSyncs,
  countPendingReceiptSheetSyncs,
  getReceiptDatabaseColumnNames,
  markReceiptSheetSynced,
  markReceiptSheetSyncFailed,
  saveReceiptToSqlite
} from "../integrations/sqlite/receipt-store.js";
import { RECEIPT_RAW_COLUMNS, toReceiptRawRow } from "../domains/receipts/receipt-raw-row.js";
import type { ReceiptPayload } from "../domains/receipts/receipt.schema.js";

const payload: ReceiptPayload = {
  schema_version: "receipt.v1.1",
  receipt_id: "telegram:receipt-sqlite-test-1",
  source: {
    platform: "telegram",
    chat_id: "telegram-test-chat",
    message_id: "receipt-sqlite-test-1",
    received_at: "2026-10-17T01:02:03.000Z"
  },
  merchant_name: "Test Kopi",
  receipt_date: "2026-10-16",
  total_amount: 42_000,
  tax_amount: 3_780,
  payment_method: "db-bca",
  tax_label_raw: "PB1",
  classification: "food",
  currency: "IDR",
  month_key: "2026-10",
  confidence: 0.97,
  needs_review: false,
  raw_json: { ocr_excerpt: "Test Kopi total 42000", intent: "receipt" }
};

const temporaryDirectory = await mkdtemp(join(tmpdir(), "openclaw-receipt-sqlite-"));
const databasePath = join(temporaryDirectory, "data", "finance.sqlite");

try {
  const firstSave = saveReceiptToSqlite(payload, databasePath);
  assert.equal(firstSave.status, "saved");
  assert.deepEqual(firstSave.payload, payload);
  assert.equal(firstSave.sheetsSyncedAt, null);
  assert.deepEqual(getReceiptDatabaseColumnNames(databasePath), RECEIPT_RAW_COLUMNS);

  const database = new DatabaseSync(databasePath);
  try {
    const storedRow = database
      .prepare(`SELECT ${RECEIPT_RAW_COLUMNS.join(", ")} FROM receipts WHERE receipt_id = ?`)
      .get(payload.receipt_id) as Record<string, string | number>;
    const rowValues = RECEIPT_RAW_COLUMNS.map((column) =>
      column === "needs_review" ? Number(storedRow[column]) === 1 : storedRow[column]
    );
    assert.deepEqual(rowValues, toReceiptRawRow(payload));
  } finally {
    database.close();
  }

  const changedDuplicate = { ...payload, merchant_name: "A different parsed merchant", total_amount: 99_000 };
  const duplicateSave = saveReceiptToSqlite(changedDuplicate, databasePath);
  assert.equal(duplicateSave.status, "duplicate");
  assert.equal(duplicateSave.payload.merchant_name, payload.merchant_name);
  assert.equal(duplicateSave.payload.total_amount, payload.total_amount);
  assert.equal(countPendingReceiptSheetSyncs(databasePath), 1);

  const firstClaim = claimPendingReceiptSheetSyncs(databasePath, { nowMs: 1_000_000, leaseMs: 10_000 });
  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0]?.receiptId, payload.receipt_id);
  assert.deepEqual(firstClaim[0]?.payload, payload);
  assert.equal(firstClaim[0]?.attempts, 1);
  assert.equal(claimPendingReceiptSheetSyncs(databasePath, { nowMs: 1_000_001, leaseMs: 10_000 }).length, 0);

  assert.equal(markReceiptSheetSyncFailed(payload.receipt_id, databasePath, new Error("temporary Sheets error"), 1_000_000), true);
  assert.equal(claimPendingReceiptSheetSyncs(databasePath, { nowMs: 1_029_999 }).length, 0);

  const retryClaim = claimPendingReceiptSheetSyncs(databasePath, { nowMs: 1_030_000, leaseMs: 10_000 });
  assert.equal(retryClaim.length, 1);
  assert.equal(retryClaim[0]?.attempts, 2);
  assert.equal(markReceiptSheetSynced(payload.receipt_id, databasePath, "2026-10-17T02:00:00.000Z"), true);
  assert.equal(countPendingReceiptSheetSyncs(databasePath), 0);

  const persistedDuplicate = saveReceiptToSqlite(payload, databasePath);
  assert.equal(persistedDuplicate.status, "duplicate");
  assert.equal(persistedDuplicate.sheetsSyncedAt, "2026-10-17T02:00:00.000Z");

  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/test-only-service-account.json";
  process.env.RECEIPT_SPREADSHEET_ID = "test-only-spreadsheet";
  process.env.RECEIPT_JOURNAL_PATH = "/tmp/test-only-receipt-journal.md";
  process.env.RECEIPT_SAVE_JOURNAL = "false";
  process.env.RECEIPT_SAVE_SHEETS = "true";
  process.env.FINANCE_SQLITE_PATH = databasePath;

  const { hasFailedEnabledSink, saveConfirmedReceipt } = await import(
    "../usecases/receipt-assistant/save-confirmed-receipt.js"
  );
  const queuedPayload: ReceiptPayload = {
    ...payload,
    receipt_id: "telegram:receipt-sqlite-test-queued",
    source: { ...payload.source, message_id: "receipt-sqlite-test-queued" }
  };
  const saveResult = await saveConfirmedReceipt(queuedPayload);
  assert.equal(saveResult.sqlite.status, "saved");
  assert.equal(saveResult.sheets.status, "queued");
  assert.equal(saveResult.journal.status, "skipped");
  assert.equal(hasFailedEnabledSink(saveResult), false);
  assert.equal(countPendingReceiptSheetSyncs(databasePath), 1);

  console.log("receipt SQLite tests passed");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
