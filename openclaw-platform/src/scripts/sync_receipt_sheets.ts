import { env } from "../config/env.js";
import {
  claimPendingReceiptSheetSyncs,
  markReceiptSheetSynced,
  markReceiptSheetSyncFailed,
  countPendingReceiptSheetSyncs
} from "../integrations/sqlite/receipt-store.js";
import { persistReceiptPayload } from "../usecases/receipt-assistant/save-receipt-row.js";

const SYNC_BATCH_SIZE = 25;
const SYNC_LEASE_MS = 10 * 60 * 1000;
const RUN_ONCE = process.argv.includes("--once");

let cycleRunning = false;

async function syncPendingReceipts(): Promise<void> {
  if (!env.RECEIPT_SAVE_SHEETS || cycleRunning) return;
  cycleRunning = true;

  try {
    const pending = claimPendingReceiptSheetSyncs(env.FINANCE_SQLITE_PATH, {
      batchSize: SYNC_BATCH_SIZE,
      leaseMs: SYNC_LEASE_MS
    });

    for (const receipt of pending) {
      try {
        await persistReceiptPayload(receipt.payload);
        const markedSynced = markReceiptSheetSynced(receipt.receiptId, env.FINANCE_SQLITE_PATH);
        if (!markedSynced) throw new Error("Receipt disappeared before its Google Sheets sync was recorded.");
        console.info(`[receipt-sheet-sync] synced ${receipt.receiptId}`);
      } catch (error) {
        try {
          markReceiptSheetSyncFailed(receipt.receiptId, env.FINANCE_SQLITE_PATH, error);
        } catch (storeError) {
          console.error(`[receipt-sheet-sync] could not record failure for ${receipt.receiptId}: ${errorText(storeError)}`);
        }
        console.error(`[receipt-sheet-sync] failed ${receipt.receiptId}: ${errorText(error)}`);
      }
    }

    if (pending.length > 0) {
      console.info(
        `[receipt-sheet-sync] processed ${pending.length}; pending=${countPendingReceiptSheetSyncs(env.FINANCE_SQLITE_PATH)}`
      );
    }
  } finally {
    cycleRunning = false;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}

async function main(): Promise<void> {
  if (RUN_ONCE) {
    await syncPendingReceipts();
    return;
  }

  await syncPendingReceipts();
  const timer = setInterval(() => {
    void syncPendingReceipts().catch((error) => {
      console.error(`[receipt-sheet-sync] cycle failed: ${errorText(error)}`);
    });
  }, env.RECEIPT_SHEETS_SYNC_INTERVAL_MS);

  const stop = (): void => {
    clearInterval(timer);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main().catch((error) => {
  console.error(`[receipt-sheet-sync] worker failed: ${errorText(error)}`);
  process.exitCode = 1;
});
