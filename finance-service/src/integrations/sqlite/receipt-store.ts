import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { RECEIPT_RAW_COLUMNS, toReceiptRawRecord } from "../../domains/receipts/receipt-raw-row.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";

export type ReceiptStoreResult = {
  status: "saved" | "duplicate";
  payload: ReceiptPayload;
  sheetsSyncedAt: string | null;
};

export type PendingReceiptSheetSync = {
  receiptId: string;
  payload: ReceiptPayload;
  attempts: number;
};

type ReceiptDatabaseRow = {
  receipt_id: string;
  payload_json: string;
  google_sheets_sync_attempts: number;
};

type StoredReceiptDatabaseRow = {
  payload_json: string;
  google_sheets_synced_at: string | null;
};

const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

function openReceiptDatabase(databasePath: string): DatabaseSync {
  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const database = new DatabaseSync(absolutePath);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS receipts (
      receipt_id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      receipt_date TEXT NOT NULL,
      total_amount REAL NOT NULL,
      tax_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      classification TEXT NOT NULL,
      currency TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL CHECK (needs_review IN (0, 1)),
      tax_label_raw TEXT NOT NULL,
      month_key TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      google_sheets_synced_at TEXT,
      google_sheets_sync_lease_until_ms INTEGER,
      google_sheets_sync_attempts INTEGER NOT NULL DEFAULT 0,
      google_sheets_sync_next_attempt_at_ms INTEGER,
      google_sheets_sync_last_attempt_at_ms INTEGER,
      google_sheets_sync_last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS receipts_sheets_outbox_idx
      ON receipts (google_sheets_synced_at, google_sheets_sync_next_attempt_at_ms, created_at);
  `);

  return database;
}

function parseStoredPayload(value: string): ReceiptPayload {
  return JSON.parse(value) as ReceiptPayload;
}

export function saveReceiptToSqlite(payload: ReceiptPayload, databasePath: string): ReceiptStoreResult {
  const database = openReceiptDatabase(databasePath);
  try {
    const record = toReceiptRawRecord(payload);
    const insertResult = database
      .prepare(`
        INSERT OR IGNORE INTO receipts (
          receipt_id, message_id, merchant_name, receipt_date, total_amount, tax_amount,
          payment_method, classification, currency, confidence, needs_review, tax_label_raw,
          month_key, raw_json, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.receipt_id,
        record.message_id,
        record.merchant_name,
        record.receipt_date,
        record.total_amount,
        record.tax_amount,
        record.payment_method,
        record.classification,
        record.currency,
        record.confidence,
        Number(record.needs_review),
        record.tax_label_raw,
        record.month_key,
        record.raw_json,
        JSON.stringify(payload)
      );

    const stored = database
      .prepare("SELECT payload_json, google_sheets_synced_at FROM receipts WHERE receipt_id = ?")
      .get(record.receipt_id) as StoredReceiptDatabaseRow | undefined;
    if (!stored) throw new Error(`SQLite did not return saved receipt ${record.receipt_id}.`);

    return {
      status: Number(insertResult.changes) > 0 ? "saved" : "duplicate",
      payload: parseStoredPayload(stored.payload_json),
      sheetsSyncedAt: stored.google_sheets_synced_at
    };
  } finally {
    database.close();
  }
}

export function claimPendingReceiptSheetSyncs(
  databasePath: string,
  options: { batchSize?: number; leaseMs?: number; nowMs?: number } = {}
): PendingReceiptSheetSync[] {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 25));
  const leaseMs = Math.max(1_000, options.leaseMs ?? 10 * 60 * 1000);
  const nowMs = options.nowMs ?? Date.now();
  const database = openReceiptDatabase(databasePath);

  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const rows = database
        .prepare(`
          SELECT receipt_id, payload_json, google_sheets_sync_attempts
          FROM receipts
          WHERE google_sheets_synced_at IS NULL
            AND (google_sheets_sync_lease_until_ms IS NULL OR google_sheets_sync_lease_until_ms <= ?)
            AND (google_sheets_sync_next_attempt_at_ms IS NULL OR google_sheets_sync_next_attempt_at_ms <= ?)
          ORDER BY created_at, receipt_id
          LIMIT ?
        `)
        .all(nowMs, nowMs, batchSize) as ReceiptDatabaseRow[];

      const updateLease = database.prepare(`
        UPDATE receipts
        SET google_sheets_sync_lease_until_ms = ?,
            google_sheets_sync_attempts = google_sheets_sync_attempts + 1,
            google_sheets_sync_last_attempt_at_ms = ?
        WHERE receipt_id = ?
          AND google_sheets_synced_at IS NULL
          AND (google_sheets_sync_lease_until_ms IS NULL OR google_sheets_sync_lease_until_ms <= ?)
          AND (google_sheets_sync_next_attempt_at_ms IS NULL OR google_sheets_sync_next_attempt_at_ms <= ?)
      `);

      const claimed: PendingReceiptSheetSync[] = [];
      for (const row of rows) {
        const result = updateLease.run(nowMs + leaseMs, nowMs, row.receipt_id, nowMs, nowMs);
        if (Number(result.changes) === 1) {
          claimed.push({
            receiptId: row.receipt_id,
            payload: parseStoredPayload(row.payload_json),
            attempts: Number(row.google_sheets_sync_attempts) + 1
          });
        }
      }

      database.exec("COMMIT");
      return claimed;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

export function markReceiptSheetSynced(
  receiptId: string,
  databasePath: string,
  syncedAt: string = new Date().toISOString()
): boolean {
  const database = openReceiptDatabase(databasePath);
  try {
    const result = database
      .prepare(`
        UPDATE receipts
        SET google_sheets_synced_at = ?,
            google_sheets_sync_lease_until_ms = NULL,
            google_sheets_sync_next_attempt_at_ms = NULL,
            google_sheets_sync_last_error = NULL
        WHERE receipt_id = ?
      `)
      .run(syncedAt, receiptId);
    return Number(result.changes) === 1;
  } finally {
    database.close();
  }
}

export function markReceiptSheetSyncFailed(
  receiptId: string,
  databasePath: string,
  error: unknown,
  nowMs: number = Date.now()
): boolean {
  const database = openReceiptDatabase(databasePath);
  try {
    const row = database
      .prepare("SELECT google_sheets_sync_attempts FROM receipts WHERE receipt_id = ?")
      .get(receiptId) as { google_sheets_sync_attempts: number } | undefined;
    if (!row) return false;

    const attempts = Math.max(1, Number(row.google_sheets_sync_attempts));
    const backoffExponent = Math.min(attempts - 1, 10);
    const nextAttemptAtMs = nowMs + Math.min(INITIAL_RETRY_DELAY_MS * 2 ** backoffExponent, MAX_RETRY_DELAY_MS);
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 500);
    const result = database
      .prepare(`
        UPDATE receipts
        SET google_sheets_sync_lease_until_ms = NULL,
            google_sheets_sync_next_attempt_at_ms = ?,
            google_sheets_sync_last_error = ?
        WHERE receipt_id = ? AND google_sheets_synced_at IS NULL
      `)
      .run(nextAttemptAtMs, message, receiptId);
    return Number(result.changes) === 1;
  } finally {
    database.close();
  }
}

export function countPendingReceiptSheetSyncs(databasePath: string): number {
  const database = openReceiptDatabase(databasePath);
  try {
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM receipts WHERE google_sheets_synced_at IS NULL")
      .get() as { count: number };
    return Number(row.count);
  } finally {
    database.close();
  }
}

export function getReceiptDatabaseColumnNames(databasePath: string): string[] {
  const database = openReceiptDatabase(databasePath);
  try {
    const rows = database.prepare("PRAGMA table_info(receipts)").all() as Array<{ name: string }>;
    return rows.map((row) => row.name).filter((name) => (RECEIPT_RAW_COLUMNS as readonly string[]).includes(name));
  } finally {
    database.close();
  }
}
