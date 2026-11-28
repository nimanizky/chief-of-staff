import { env } from "../config/env.js";
import { GoogleSheetsFinanceDigestRepository } from "../integrations/google-sheets/finance-digest.repository.js";
import { sendTelegramText } from "../integrations/telegram/send-telegram-text.js";
import { formatFinanceDigest } from "../usecases/finance-digest/format-finance-digest.js";
import { getFinanceDigest } from "../usecases/finance-digest/get-finance-digest.js";

const preview = process.argv.includes("--preview");
const force = process.argv.includes("--force");

async function main(): Promise<void> {
  if (!env.FINANCE_DIGEST_ENABLED && !force) {
    throw new Error("Finance digest is disabled. Set FINANCE_DIGEST_ENABLED=true or use --force.");
  }

  const digest = await getFinanceDigest(new GoogleSheetsFinanceDigestRepository(), {
    timezone: env.FINANCE_DIGEST_TIMEZONE,
    lookaheadDays: env.FINANCE_DIGEST_LOOKAHEAD_DAYS
  });
  const message = formatFinanceDigest(digest);

  if (preview) {
    console.log(message);
    return;
  }

  if (!env.FINANCE_DIGEST_TELEGRAM_CHAT_ID) {
    throw new Error("FINANCE_DIGEST_TELEGRAM_CHAT_ID is required for scheduled delivery.");
  }

  await sendTelegramText(env.FINANCE_DIGEST_TELEGRAM_CHAT_ID, message);
  console.log("Finance digest sent.");
}

main().catch((error) => {
  console.error((error as Error)?.message ?? "Finance digest failed.");
  process.exitCode = 1;
});
