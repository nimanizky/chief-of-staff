import { google } from "googleapis";
import { env } from "../../config/env.js";

export function createSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}
