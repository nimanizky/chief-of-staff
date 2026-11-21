import { readFile, writeFile } from "node:fs/promises";
import { env } from "../../config/env.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { formatReceiptTable } from "../../domains/receipts/receipt-formatting.js";
import { commitMemoryVaultFile } from "../memory/git-memory-vault.js";
import { logReceiptOutcome } from "../../observability/receipt_logger.js";

export function formatJournalEntry(payload: ReceiptPayload): string {
  return `## ${new Date().toISOString()} - ${payload.merchant_name} - ${payload.total_amount} ${payload.currency}

${formatReceiptTable(payload, 5000)}
`;
}

export async function prependReceiptJournalEntry(payload: ReceiptPayload): Promise<"appended" | "duplicate"> {
  let existing = "";
  try {
    existing = await readFile(env.RECEIPT_JOURNAL_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (existing.includes(payload.receipt_id)) {
    return "duplicate";
  }

  const entry = formatJournalEntry(payload);
  const nextContent = existing.trim().length > 0 ? `${entry}\n${existing}` : `${entry}\n`;
  await writeFile(env.RECEIPT_JOURNAL_PATH, nextContent, "utf8");
  await tryCommitReceiptJournal(payload);

  logReceiptOutcome({
    receipt_id: payload.receipt_id,
    outcome: "appended",
    merchant_name: payload.merchant_name,
    receipt_date: payload.receipt_date,
    classification: payload.classification,
    confidence: payload.confidence,
    needs_review: payload.needs_review,
    metadata: {
      journal_path: env.RECEIPT_JOURNAL_PATH
    }
  });

  return "appended";
}

async function tryCommitReceiptJournal(payload: ReceiptPayload): Promise<void> {
  try {
    const result = await commitMemoryVaultFile(
      env.RECEIPT_JOURNAL_PATH,
      `memory: add receipt ${payload.merchant_name} ${payload.receipt_date}`
    );

    if (result.status === "skipped") {
      return;
    }

    console.info(
      `[memory-vault] committed receipt journal change for ${payload.receipt_id}` +
        (result.pushed ? " and pushed" : "")
    );
  } catch (error) {
    console.warn(
      `[memory-vault] failed to commit receipt journal change for ${payload.receipt_id}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
