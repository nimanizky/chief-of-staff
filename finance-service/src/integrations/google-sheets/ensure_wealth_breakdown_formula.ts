import { env } from "../../config/env.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";

export const wealthBreakdownDetailFormula = `=IFERROR(LET(raw,FILTER({${env.WEALTH_SHEET_RAW}!E2:E,${env.WEALTH_SHEET_RAW}!F2:F,${env.WEALTH_SHEET_RAW}!H2:H,${env.WEALTH_SHEET_RAW}!I2:I,${env.WEALTH_SHEET_RAW}!A2:A,${env.WEALTH_SHEET_RAW}!C2:C},${env.WEALTH_SHEET_RAW}!A2:A<>""),keys,INDEX(raw,,1)&"|"&INDEX(raw,,2)&"|"&INDEX(raw,,3),latest_keys,QUERY({keys,INDEX(raw,,6)},"select Col1, max(Col2) group by Col1 label Col1 '', max(Col2) ''",0),latest,FILTER(raw,ISNUMBER(MATCH(keys&"|"&INDEX(raw,,6),INDEX(latest_keys,,1)&"|"&INDEX(latest_keys,,2),0))),QUERY(latest,"select Col1, Col2, Col3, sum(Col4), max(Col5), max(Col6) where Col1 is not null and Col1 <> '' group by Col1, Col2, Col3 order by Col1 desc, Col2, Col3 label Col1 'month_key', Col2 'platform', Col3 'asset_type', sum(Col4) 'amount', max(Col5) 'snapshot_id', max(Col6) 'uploaded_at'",0)),{"month_key","platform","asset_type","amount","snapshot_id","uploaded_at"})`;

export const wealthBreakdownPivotFormula = `=IFERROR(LET(raw,FILTER({${env.WEALTH_SHEET_RAW}!E2:E,${env.WEALTH_SHEET_RAW}!F2:F,${env.WEALTH_SHEET_RAW}!H2:H,${env.WEALTH_SHEET_RAW}!I2:I,${env.WEALTH_SHEET_RAW}!C2:C},${env.WEALTH_SHEET_RAW}!A2:A<>""),keys,INDEX(raw,,1)&"|"&INDEX(raw,,2)&"|"&INDEX(raw,,3),latest_keys,QUERY({keys,INDEX(raw,,5)},"select Col1, max(Col2) group by Col1 label Col1 '', max(Col2) ''",0),latest,FILTER(raw,ISNUMBER(MATCH(keys&"|"&INDEX(raw,,5),INDEX(latest_keys,,1)&"|"&INDEX(latest_keys,,2),0))),source,{INDEX(latest,,1),INDEX(latest,,2)&"_"&INDEX(latest,,3),INDEX(latest,,4)},total,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 order by Col1 desc label Col1 'month_key', sum(Col3) 'total_wealth'",0),pivot,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 pivot Col2 order by Col1 desc label Col1 'month_key', sum(Col3) ''",0),HSTACK(total,CHOOSECOLS(pivot,SEQUENCE(1,COLUMNS(pivot)-1,2,1)))),{"month_key","total_wealth"})`;

export async function ensureWealthBreakdownFormulas(): Promise<void> {
  try {
    const sheets = createSheetsClient();
    const current = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      ranges: [`${env.WEALTH_BREAKDOWN_SHEET}!A1`, `${env.WEALTH_BREAKDOWN_SHEET}!H1`],
      valueRenderOption: "FORMULA"
    });
    const currentDetail = current.data.valueRanges?.[0]?.values?.[0]?.[0];
    const currentPivot = current.data.valueRanges?.[1]?.values?.[0]?.[0];
    const data: Array<{ range: string; values: string[][] }> = [];

    if (currentDetail !== wealthBreakdownDetailFormula) {
      data.push({
        range: `${env.WEALTH_BREAKDOWN_SHEET}!A1`,
        values: [[wealthBreakdownDetailFormula]]
      });
    }
    if (currentPivot !== wealthBreakdownPivotFormula) {
      data.push({
        range: `${env.WEALTH_BREAKDOWN_SHEET}!H1`,
        values: [[wealthBreakdownPivotFormula]]
      });
    }
    if (data.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data
      }
    });
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not update wealth_breakdown formulas.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
