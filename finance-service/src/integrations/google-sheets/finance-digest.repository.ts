import type {
  FinanceDigestRepository,
  FinanceSourceResult,
  PaymentCalendarRow,
  ReceiptQualityRow,
  WeeklySpendRow
} from "../../domains/finance/finance-digest.js";
import { env } from "../../config/env.js";
import { createSheetsClient } from "./sheets_client.js";
import {
  parsePaymentCalendar,
  parseReceiptQuality,
  parseWeeklySpend,
  type FinanceSheetRows
} from "./finance-digest-sheet-parser.js";

export class GoogleSheetsFinanceDigestRepository implements FinanceDigestRepository {
  async readWeeklySpend(): Promise<FinanceSourceResult<WeeklySpendRow>> {
    const rows = await readSheet(env.FINANCE_WEEKLY_SPEND_SHEET);
    return parseWeeklySpend(rows);
  }

  async readPaymentCalendar(): Promise<FinanceSourceResult<PaymentCalendarRow>> {
    const rows = await readSheet(env.FINANCE_PAYMENT_CALENDAR_SHEET);
    return parsePaymentCalendar(rows);
  }

  async readReceiptQuality(): Promise<FinanceSourceResult<ReceiptQualityRow>> {
    const rows = await readSheet(env.RECEIPT_SHEET_RAW);
    return parseReceiptQuality(rows);
  }
}

async function readSheet(sheetName: string): Promise<FinanceSheetRows> {
  const sheets = createSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
    range: `${quoteSheetName(sheetName)}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER"
  });
  return (response.data.values ?? []) as FinanceSheetRows;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}
