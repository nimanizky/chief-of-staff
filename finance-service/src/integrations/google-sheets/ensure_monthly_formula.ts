import { env } from "../../config/env.js";
import { createSheetsClient } from "./sheets_client.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";

const formula = `=QUERY({ARRAYFORMULA(IF(${env.RECEIPT_SHEET_RAW}!D2:D<>"",TEXT(${env.RECEIPT_SHEET_RAW}!D2:D,"yyyy-mm"),)),${env.RECEIPT_SHEET_RAW}!H2:H,${env.RECEIPT_SHEET_RAW}!E2:E,${env.RECEIPT_SHEET_RAW}!F2:F,${env.RECEIPT_SHEET_RAW}!A2:A},"select Col1, Col2, sum(Col3), sum(Col4), count(Col5) where Col1 is not null group by Col1, Col2 label Col1 'month', Col2 'classification', sum(Col3) 'total_amount', sum(Col4) 'total_tax', count(Col5) 'receipt_count'",0)`;

export async function ensureMonthlyBreakdownFormula(): Promise<void> {
  try {
    const sheets = createSheetsClient();
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.RECEIPT_SHEET_MONTHLY}!A1`
    });

    const cell = read.data.values?.[0]?.[0];
    if (cell) return;

    await sheets.spreadsheets.values.update({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.RECEIPT_SHEET_MONTHLY}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[formula]] }
    });
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not update monthly_breakdown formula.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
