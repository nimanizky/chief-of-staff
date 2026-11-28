import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ConfirmedReceiptSaveResult } from "../usecases/receipt-assistant/save-confirmed-receipt.js";
import type { ReceiptPayload } from "../domains/receipts/receipt.schema.js";
import { createFinanceHttpServer } from "../modules/finance/adapters/http/finance-http-server.js";
import { createFinanceApplication } from "../modules/finance/application/finance-application.js";

const TOKEN = "finance-api-test-token-0123456789abcdef";
const paymentMethods = ["db-bca", "cash"];
const savedReceipts = new Set<string>();
const writtenPayloads: ReceiptPayload[] = [];
let failNextWrite = false;
const saveResult = (status: "saved" | "duplicate"): ConfirmedReceiptSaveResult => ({
  sqlite: { enabled: true, status },
  journal: { enabled: false, status: "skipped" },
  sheets: { enabled: true, status: status === "duplicate" ? "duplicate" : "queued" }
});

const application = createFinanceApplication({
  paymentMethods,
  now: () => new Date("2026-10-17T00:00:00.000Z"),
  async saveConfirmedReceipt(payload) {
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error("fake storage failure");
    }
    writtenPayloads.push(payload);
    const isDuplicate = savedReceipts.has(payload.receipt_id);
    savedReceipts.add(payload.receipt_id);
    return saveResult(isDuplicate ? "duplicate" : "saved");
  }
});

const server = createFinanceHttpServer(application, TOKEN);
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert.ok(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const unauthorized = await fetch(`${baseUrl}/api/v1/finance/payment-methods`);
  assert.equal(unauthorized.status, 401);

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  };
  const methodsResponse = await fetch(`${baseUrl}/api/v1/finance/payment-methods`, { headers });
  assert.equal(methodsResponse.status, 200);
  assert.deepEqual(await methodsResponse.json(), { payment_methods: paymentMethods });

  const receiptInput = {
    idempotency_key: "test-id-1",
    merchant_name: "Kopi Pagi",
    receipt_date: "2026-10-17",
    total_amount: 42_000,
    tax_amount: 3_780,
    payment_method: "db-bca",
    tax_label_raw: "PB1",
    classification: "food",
    currency: "IDR",
    confidence: 0.97
  };

  const previewResponse = await fetch(`${baseUrl}/api/v1/finance/receipts/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify(receiptInput)
  });
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()) as { receipt_id: string; writes_data: boolean };
  assert.equal(preview.writes_data, false);
  assert.equal(writtenPayloads.length, 0, "Preview must not call the persistence adapter.");

  const invalidDateResponse = await fetch(`${baseUrl}/api/v1/finance/receipts/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...receiptInput, receipt_date: "2026-02-30" })
  });
  assert.equal(invalidDateResponse.status, 400, "Impossible calendar dates must be rejected.");

  const missingConfirmation = await fetch(`${baseUrl}/api/v1/finance/receipts`, {
    method: "POST",
    headers,
    body: JSON.stringify(receiptInput)
  });
  assert.equal(missingConfirmation.status, 400);
  assert.equal(writtenPayloads.length, 0, "A missing user confirmation must not write data.");

  failNextWrite = true;
  const storageFailure = await fetch(`${baseUrl}/api/v1/finance/receipts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...receiptInput, idempotency_key: "storage-failure-001", user_confirmed: true })
  });
  assert.equal(storageFailure.status, 503, "Unexpected canonical-writer failures must not look like successful saves.");
  assert.equal(writtenPayloads.length, 0);

  const recordResponse = await fetch(`${baseUrl}/api/v1/finance/receipts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...receiptInput, user_confirmed: true })
  });
  assert.equal(recordResponse.status, 201);
  const recordResult = (await recordResponse.json()) as {
    receipt_id: string;
    storage_status: string;
    sheet_sync_status: string;
  };
  assert.equal(recordResult.receipt_id, preview.receipt_id);
  assert.equal(recordResult.storage_status, "saved");
  assert.equal(recordResult.sheet_sync_status, "queued");
  assert.equal(writtenPayloads.length, 1);
  assert.equal(writtenPayloads[0]?.source.platform, "finance_api");
  assert.equal(writtenPayloads[0]?.raw_json.idempotency_key, undefined);

  const duplicateResponse = await fetch(`${baseUrl}/api/v1/finance/receipts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...receiptInput, user_confirmed: true })
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal(((await duplicateResponse.json()) as { storage_status: string }).storage_status, "duplicate");

  const client = new Client({ name: "finance-api-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    authProvider: { token: async () => TOKEN }
  });
  try {
    await client.connect(transport);
    const listedTools = await client.listTools();
    assert.deepEqual(
      listedTools.tools.map((tool) => tool.name).sort(),
      ["list_finance_payment_methods", "preview_finance_receipt", "record_finance_receipt", "get_finance_budget", "get_finance_digest", "preview_finance_cicilan", "confirm_finance_cicilan", "preview_finance_wealth", "confirm_finance_wealth", "parse_finance_wealth_image", "run_wishlist_command", "get_model_health"].sort()
    );

    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/test.json";
    process.env.RECEIPT_SPREADSHEET_ID = "offline-test";
    process.env.RECEIPT_JOURNAL_PATH = "/nonexistent/journal.md";
    const cicilan = await client.callTool({ name: "preview_finance_cicilan", arguments: { text: "cicilan cc bca anytime fitness 5999k 12 kali 0%", idempotency_key: "test-cicilan-001" } });
    assert.equal(cicilan.isError, undefined);
    const wealth = await client.callTool({ name: "preview_finance_wealth", arguments: { text: "wealth jago 15.2jt cash", idempotency_key: "test-wealth-001" } });
    assert.equal(wealth.isError, undefined);
    const unconfirmed = await client.callTool({ name: "confirm_finance_wealth", arguments: { token: "any-token", user_confirmed: false } });
    assert.equal(unconfirmed.isError, true, "Wealth write must require user confirmation.");

    // Tools ported from openclaw-platform. Checked offline: schema rejection and
    // gating only, so no model or Google credentials are needed.
    const badMedia = await client.callTool({
      name: "parse_finance_wealth_image",
      arguments: { media_base64: "short", mime_type: "image/png", idempotency_key: "test-wealth-image-001" }
    });
    assert.equal(badMedia.isError, true, "Wealth image parsing must reject an undersized base64 payload.");

    const badMediaType = await client.callTool({
      name: "parse_finance_wealth_image",
      arguments: { media_base64: "x".repeat(64), mime_type: "text/plain", idempotency_key: "test-wealth-image-002" }
    });
    assert.equal(badMediaType.isError, true, "Wealth image parsing must reject a non-image, non-PDF media type.");

    const wishlistDenied = await client.callTool({
      name: "run_wishlist_command",
      arguments: { text: "show ykc", chat_id: "not-an-allowed-group", source_platform: "whatsapp" }
    });
    assert.equal(wishlistDenied.isError, undefined);
    assert.match(
      String((wishlistDenied.structuredContent as { message?: string })?.message ?? ""),
      /WISHLIST_ALLOWED_GROUPS/,
      "Wishlist must refuse a chat that is not allowlisted."
    );

    const wishlistWrongPlatform = await client.callTool({
      name: "run_wishlist_command",
      arguments: { text: "show ykc", chat_id: "any", source_platform: "telegram" }
    });
    assert.equal(wishlistWrongPlatform.isError, undefined);
    assert.match(
      String((wishlistWrongPlatform.structuredContent as { message?: string })?.message ?? ""),
      /not enabled for this chat/,
      "Wishlist must stay WhatsApp-only."
    );

    const mcpMethods = await client.callTool({
      name: "list_finance_payment_methods",
      arguments: {}
    });
    assert.equal(mcpMethods.isError, undefined);
    assert.deepEqual(mcpMethods.structuredContent, { payment_methods: paymentMethods });

    const mcpPreview = await client.callTool({
      name: "preview_finance_receipt",
      arguments: { ...receiptInput, idempotency_key: "mcp-preview-2026-10-17" }
    });
    assert.equal(mcpPreview.isError, undefined);
    assert.equal(writtenPayloads.length, 2, "MCP preview must not call the persistence adapter.");

    const mcpRecord = await client.callTool({
      name: "record_finance_receipt",
      arguments: {
        ...receiptInput,
        idempotency_key: "test-id-2",
        user_confirmed: true
      }
    });
    assert.equal(mcpRecord.isError, undefined);
    assert.equal(writtenPayloads.length, 3);
  assert.equal(writtenPayloads[2]?.source.platform, "mcp");
  } finally {
    await client.close();
  }

  console.log("Finance API and MCP tests passed (no credentials or external services used).");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
