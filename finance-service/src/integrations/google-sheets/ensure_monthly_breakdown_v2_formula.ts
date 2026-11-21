import { env } from "../../config/env.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";

export const monthlyBreakdownV2DetailFormula = `=LET(receipt_rows,IFERROR(FILTER({TEXT(${env.RECEIPT_SHEET_RAW}!D2:D,"yyyy-mm"),${env.RECEIPT_SHEET_RAW}!H2:H,${env.RECEIPT_SHEET_RAW}!E2:E,${env.RECEIPT_SHEET_RAW}!F2:F,${env.RECEIPT_SHEET_RAW}!A2:A},${env.RECEIPT_SHEET_RAW}!D2:D<>""),{"","","","",""}),cicilan_rows,IFERROR(REDUCE({"","","","",""},FILTER(${env.CICILAN_SHEET_RAW}!A2:A,${env.CICILAN_SHEET_RAW}!A2:A<>""),LAMBDA(acc,id,LET(r,MATCH(id,${env.CICILAN_SHEET_RAW}!A:A,0),tenor,VALUE(INDEX(${env.CICILAN_SHEET_RAW}!I:I,r)),amount,VALUE(INDEX(${env.CICILAN_SHEET_RAW}!E:E,r)),month_key,INDEX(${env.CICILAN_SHEET_RAW}!J:J,r),offsets,SEQUENCE(tenor,1,0),VSTACK(acc,HSTACK(MAP(offsets,LAMBDA(o,TEXT(EDATE(DATEVALUE(month_key&"-01"),o),"yyyy-mm"))),MAP(offsets,LAMBDA(o,"cicilan")),MAP(offsets,LAMBDA(o,ROUND(amount/tenor))),MAP(offsets,LAMBDA(o,0)),MAP(offsets,LAMBDA(o,id))))))),{"","","","",""}),QUERY({receipt_rows;cicilan_rows},"select Col1, Col2, sum(Col3), sum(Col4), count(Col5) where Col1 is not null and Col1 <> '' group by Col1, Col2 order by Col1 desc, Col2 label Col1 'month', Col2 'classification', sum(Col3) 'total_amount', sum(Col4) 'total_tax', count(Col5) 'receipt_count'",0))`;

export const monthlyBreakdownV2PivotFormula = `=LET(receipt_rows,IFERROR(FILTER({TEXT(${env.RECEIPT_SHEET_RAW}!D2:D,"yyyy-mm"),${env.RECEIPT_SHEET_RAW}!H2:H,${env.RECEIPT_SHEET_RAW}!E2:E},${env.RECEIPT_SHEET_RAW}!D2:D<>""),{"","",""}),cicilan_rows,IFERROR(REDUCE({"","",""},FILTER(${env.CICILAN_SHEET_RAW}!A2:A,${env.CICILAN_SHEET_RAW}!A2:A<>""),LAMBDA(acc,id,LET(r,MATCH(id,${env.CICILAN_SHEET_RAW}!A:A,0),tenor,VALUE(INDEX(${env.CICILAN_SHEET_RAW}!I:I,r)),amount,VALUE(INDEX(${env.CICILAN_SHEET_RAW}!E:E,r)),month_key,INDEX(${env.CICILAN_SHEET_RAW}!J:J,r),offsets,SEQUENCE(tenor,1,0),VSTACK(acc,HSTACK(MAP(offsets,LAMBDA(o,TEXT(EDATE(DATEVALUE(month_key&"-01"),o),"yyyy-mm"))),MAP(offsets,LAMBDA(o,"cicilan")),MAP(offsets,LAMBDA(o,ROUND(amount/tenor)))))))),{"","",""}),source,{receipt_rows;cicilan_rows},total,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 order by Col1 desc label Col1 'month', sum(Col3) 'total_month'",0),pivot,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 pivot Col2 order by Col1 desc label Col1 'month', sum(Col3) ''",0),HSTACK(total,CHOOSECOLS(pivot,SEQUENCE(1,COLUMNS(pivot)-1,2,1))))`;

export async function ensureMonthlyBreakdownV2Formulas(): Promise<void> {
  try {
    const sheets = createSheetsClient();
    const read = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      ranges: [`${env.MONTHLY_BREAKDOWN_V2_SHEET}!A1`, `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G1`],
      valueRenderOption: "FORMULA"
    });
    const values = read.data.valueRanges ?? [];
    const currentDetail = values[0]?.values?.[0]?.[0];
    const currentPivot = values[1]?.values?.[0]?.[0];
    const updates: Array<{ range: string; values: string[][] }> = [];

    if (currentDetail !== monthlyBreakdownV2DetailFormula) {
      updates.push({
        range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!A1`,
        values: [[monthlyBreakdownV2DetailFormula]]
      });
    }
    if (currentPivot !== monthlyBreakdownV2PivotFormula) {
      updates.push({
        range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G1`,
        values: [[monthlyBreakdownV2PivotFormula]]
      });
    }
    if (updates.length === 0) {
      updates.push(
        {
          range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!A1`,
          values: [[monthlyBreakdownV2DetailFormula]]
        },
        {
          range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G1`,
          values: [[monthlyBreakdownV2PivotFormula]]
        }
      );
    }

    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      requestBody: {
        ranges: [`${env.MONTHLY_BREAKDOWN_V2_SHEET}!A:E`, `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G:T`]
      }
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates
      }
    });
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not update monthly_breakdown_v2 formulas.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
