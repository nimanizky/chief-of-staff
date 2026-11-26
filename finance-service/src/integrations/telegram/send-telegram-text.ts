import { env } from "../../config/env.js";

export async function sendTelegramText(chatId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to send the finance digest.");
  }

  const response = await fetch(
    `${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram send failed with HTTP ${response.status}.`);
  }
}
