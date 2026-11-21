import { env } from "../../config/env.js";
import { parseBudgetStatusRow } from "../../domains/budget/budget-status.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";
import type { BudgetStatusRow } from "../../domains/budget/budget-status.js";

const CONFIG_SHEET_ID = 1804700103;
const STATUS_SHEET_ID = 1804700104;

const DEFAULT_BUDGET_ROWS: Array<(string | number | boolean)[]> = [
  ["month_key", "classification", "budget_amount", "warn_pct", "hard_pct", "enabled", "note"],
  ["default", "food", 1500000, 0.8, 1, true, "edit this placeholder"],
  ["default", "groceries", 1000000, 0.8, 1, true, "edit this placeholder"],
  ["default", "dopamine", 300000, 0.8, 1, true, "edit this placeholder"],
  ["default", "mobility", 500000, 0.8, 1, true, "edit this placeholder"],
  ["default", "nonfood", 750000, 0.8, 1, true, "edit this placeholder"],
  ["default", "subscription", 500000, 0.8, 1, true, "edit this placeholder"],
  ["2026-07", "dopamine", 300000, 0.8, 1, false, "example month override; enable when needed"]
];

const BUDGET_STATUS_FORMULA =
  '=LET(current_month,TO_TEXT(TEXT(TODAY(),"yyyy-mm")),actuals,IFERROR(QUERY(monthly_breakdown_v2!A2:C,"select Col1, Col2, sum(Col3) where Col1 is not null and Col1 <> \'\' and Col2 is not null and Col2 <> \'\' group by Col1, Col2 label sum(Col3) \'\'",0),{"","",""}),categories,FILTER(budget_config!B2:B,budget_config!B2:B<>"",budget_config!F2:F=TRUE),months,UNIQUE(VSTACK(current_month,FILTER(TO_TEXT(INDEX(actuals,,1)),TO_TEXT(INDEX(actuals,,1))<>""))),pair_count,ROWS(months)*ROWS(categories),m,MAKEARRAY(pair_count,1,LAMBDA(r,col,TO_TEXT(INDEX(months,1+INT((r-1)/ROWS(categories)))))),c,MAKEARRAY(pair_count,1,LAMBDA(r,col,INDEX(categories,1+MOD(r-1,ROWS(categories))))),actual,MAP(m,c,LAMBDA(mm,cc,IFNA(INDEX(FILTER(INDEX(actuals,,3),TO_TEXT(INDEX(actuals,,1))=mm,INDEX(actuals,,2)=cc),1),0))),budget,MAP(m,c,LAMBDA(mm,cc,IFNA(INDEX(FILTER(budget_config!C2:C,budget_config!A2:A=mm,budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),IFNA(INDEX(FILTER(budget_config!C2:C,budget_config!A2:A="default",budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),)))),warn,MAP(m,c,LAMBDA(mm,cc,IFNA(INDEX(FILTER(budget_config!D2:D,budget_config!A2:A=mm,budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),IFNA(INDEX(FILTER(budget_config!D2:D,budget_config!A2:A="default",budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),0.8)))),hard,MAP(m,c,LAMBDA(mm,cc,IFNA(INDEX(FILTER(budget_config!E2:E,budget_config!A2:A=mm,budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),IFNA(INDEX(FILTER(budget_config!E2:E,budget_config!A2:A="default",budget_config!B2:B=cc,budget_config!F2:F=TRUE),1),1)))),source,MAP(m,c,LAMBDA(mm,cc,IFNA(IF(INDEX(FILTER(budget_config!C2:C,budget_config!A2:A=mm,budget_config!B2:B=cc,budget_config!F2:F=TRUE),1)<>"","month","default"),"default"))),used,MAP(actual,budget,LAMBDA(a,b,IFERROR(a/b,))),remaining,MAP(budget,actual,LAMBDA(b,a,IF(b="",,b-a))),status,MAP(used,warn,hard,budget,LAMBDA(u,w,h,b,IF(OR(b="",b<=0),"missing_budget",IF(u>=h,"over",IF(u>=w,"warning","ok"))))),message,MAP(c,actual,budget,used,remaining,status,LAMBDA(cc,a,b,u,r,s,IF(s="over",cc&": "&TEXT(a,"[$Rp]#,##0")&" / "&TEXT(b,"[$Rp]#,##0")&" ("&TEXT(u,"0%")&"). Over by "&TEXT(ABS(r),"[$Rp]#,##0")&".",IF(s="warning",cc&": "&TEXT(a,"[$Rp]#,##0")&" / "&TEXT(b,"[$Rp]#,##0")&" ("&TEXT(u,"0%")&"). Remaining "&TEXT(r,"[$Rp]#,##0")&".",cc&": "&TEXT(a,"[$Rp]#,##0")&" / "&TEXT(b,"[$Rp]#,##0")&" ("&TEXT(u,"0%")&").")))),data,FILTER({m,c,actual,budget,used,remaining,status,message,source},budget<>""),VSTACK({"month_key","classification","actual_amount","budget_amount","used_pct","remaining_amount","status","message","budget_source"},SORT(data,1,FALSE,2,TRUE)))';

export async function readBudgetStatusRows(): Promise<BudgetStatusRow[]> {
  try {
    const sheets = createSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.BUDGET_STATUS_SHEET}!A:I`,
      valueRenderOption: "UNFORMATTED_VALUE"
    });

    return (result.data.values ?? [])
      .map((row) => parseBudgetStatusRow(row))
      .filter((row): row is BudgetStatusRow => row !== null);
  } catch (error) {
    throw new ReceiptError("SHEETS_READ", "Could not read budget status from Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}

export async function ensureBudgetSheets(): Promise<void> {
  try {
    const sheets = createSheetsClient();
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      fields: "sheets.properties(sheetId,title)"
    });
    const titles = new Set((metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean));
    const requests: any[] = [];

    if (!titles.has(env.BUDGET_CONFIG_SHEET)) {
      requests.push({
        addSheet: {
          properties: {
            sheetId: CONFIG_SHEET_ID,
            title: env.BUDGET_CONFIG_SHEET,
            gridProperties: { rowCount: 1000, columnCount: 10, frozenRowCount: 1 }
          }
        }
      });
    }
    if (!titles.has(env.BUDGET_STATUS_SHEET)) {
      requests.push({
        addSheet: {
          properties: {
            sheetId: STATUS_SHEET_ID,
            title: env.BUDGET_STATUS_SHEET,
            gridProperties: { rowCount: 1000, columnCount: 12, frozenRowCount: 1 }
          }
        }
      });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
        requestBody: { requests }
      });
    }

    await ensureBudgetConfigSeed();
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.BUDGET_STATUS_SHEET}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[BUDGET_STATUS_FORMULA]]
      }
    });
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not ensure budget sheets in Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}

async function ensureBudgetConfigSeed(): Promise<void> {
  const sheets = createSheetsClient();
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
    range: `${env.BUDGET_CONFIG_SHEET}!A1:G8`,
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  const values = existing.data.values ?? [];
  if (values.length > 1) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
    range: `${env.BUDGET_CONFIG_SHEET}!A1:G8`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: DEFAULT_BUDGET_ROWS
    }
  });
}
