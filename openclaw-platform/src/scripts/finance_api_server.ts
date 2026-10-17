import { env } from "../config/env.js";
import { financeApplication } from "../modules/finance/finance-runtime.js";
import { createFinanceHttpServer } from "../modules/finance/adapters/http/finance-http-server.js";

if (!env.FINANCE_API_ENABLED) {
  console.error("Finance API is disabled. Set FINANCE_API_ENABLED=true to start it.");
  process.exit(1);
}

if (!env.FINANCE_API_TOKEN) {
  throw new Error("FINANCE_API_TOKEN is required when FINANCE_API_ENABLED=true.");
}

const server = createFinanceHttpServer(financeApplication, env.FINANCE_API_TOKEN);

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(env.FINANCE_API_PORT, env.FINANCE_API_BIND_HOST, () => {
    server.off("error", reject);
    console.log(`[finance-api] listening on http://${env.FINANCE_API_BIND_HOST}:${env.FINANCE_API_PORT}`);
    resolve();
  });
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[finance-api] received ${signal}; shutting down`);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
