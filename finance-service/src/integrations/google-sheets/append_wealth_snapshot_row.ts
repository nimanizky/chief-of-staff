import { env } from "../../config/env.js";
import type { WealthSnapshotPayload } from "../../domains/wealth/wealth.schema.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";

export type AppendWealthSnapshotResult = "appended" | "duplicate";

function toWealthRawRow(payload: WealthSnapshotPayload): (string | number)[] {
  return [
    payload.snapshot_id,
    payload.source.message_id,
    payload.uploaded_at,
    payload.snapshot_date,
    payload.month_key,
    payload.platform,
    payload.account_name,
    payload.asset_type,
    payload.amount,
    payload.currency,
    payload.source_type,
    payload.confidence,
    JSON.stringify(payload.raw_json)
  ];
}

export async function isDuplicateWealthSnapshot(snapshotId: string): Promise<boolean> {
  try {
    const sheets = createSheetsClient();
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.WEALTH_SHEET_RAW}!A:A`
    });

    const values = existing.data.values ?? [];
    return values.some((row) => row[0] === snapshotId);
  } catch (error) {
    throw new ReceiptError("SHEETS_READ", "Could not read existing wealth snapshots from Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}

export async function appendWealthSnapshotRawRow(
  payload: WealthSnapshotPayload
): Promise<AppendWealthSnapshotResult> {
  const duplicate = await isDuplicateWealthSnapshot(payload.snapshot_id);
  if (duplicate) return "duplicate";

  try {
    const sheets = createSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.WEALTH_SHEET_RAW}!A:M`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        majorDimension: "ROWS",
        values: [toWealthRawRow(payload)]
      }
    });
    return "appended";
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not append wealth snapshot into Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
