import { env } from "../../config/env.js";
import type { CicilanPayload } from "../../domains/cicilan/cicilan.schema.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";

export type AppendCicilanResult = "appended" | "duplicate";

function toCicilanRawRow(payload: CicilanPayload): (string | number)[] {
  return [
    payload.cicilan_id,
    payload.source.message_id,
    payload.merchant_name,
    payload.cicilan_date,
    payload.total_amount,
    payload.payment_method,
    payload.classification,
    payload.confidence,
    payload.tenor_months,
    payload.month_key,
    JSON.stringify(payload.raw_json)
  ];
}

export async function isDuplicateCicilan(cicilanId: string): Promise<boolean> {
  try {
    const sheets = createSheetsClient();
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.CICILAN_SHEET_RAW}!A:A`
    });

    const values = existing.data.values ?? [];
    return values.some((row) => row[0] === cicilanId);
  } catch (error) {
    throw new ReceiptError("SHEETS_READ", "Could not read existing cicilan rows from Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}

export async function appendCicilanRawRow(payload: CicilanPayload): Promise<AppendCicilanResult> {
  const duplicate = await isDuplicateCicilan(payload.cicilan_id);
  if (duplicate) return "duplicate";

  try {
    const sheets = createSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.CICILAN_SHEET_RAW}!A:K`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        majorDimension: "ROWS",
        values: [toCicilanRawRow(payload)]
      }
    });
    return "appended";
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not append cicilan into Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
