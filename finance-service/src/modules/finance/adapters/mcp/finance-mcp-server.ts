import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

/** Largest base64 media payload accepted by parse_finance_wealth_image (~6 MB of bytes). */
const MAX_MEDIA_BASE64_LENGTH = 8 * 1024 * 1024;
/** MCP request bodies must leave room for a base64 media payload plus JSON framing. */
const MAX_MCP_REQUEST_BODY_BYTES = 9 * 1024 * 1024;
import {
  FinanceReceiptInputSchema,
  FinanceReceiptRecordInputSchema,
  FinanceValidationError,
  type FinanceApplication
} from "../../application/finance-application.js";

const receiptInputSchema = toMcpInputSchema(FinanceReceiptInputSchema);
const receiptRecordInputSchema = toMcpInputSchema(FinanceReceiptRecordInputSchema);

export function createFinanceMcpServer(application: FinanceApplication): McpServer {
  const server = new McpServer({
    name: "chief-of-staff-finance",
    version: "1.0.0"
  });

  server.registerTool(
    "list_finance_payment_methods",
    {
      title: "List configured finance payment methods",
      description: "Return the exact payment_method values accepted by this Finance service.",
      inputSchema: fromJsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (_input: unknown) => {
      const result = { payment_methods: [...application.paymentMethods] };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "preview_finance_receipt",
    {
      title: "Preview finance receipt",
      description:
        "Validate a ChatGPT-parsed receipt and return the exact normalized values. This tool never saves data. Ask the user to review the preview before calling record_finance_receipt.",
      inputSchema: receiptInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      try {
        const preview = application.previewReceipt(input, "mcp");
        return {
          content: [{ type: "text", text: JSON.stringify(preview) }],
          structuredContent: preview
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "record_finance_receipt",
    {
      title: "Record confirmed finance receipt",
      description:
        "Write a receipt only after the user has reviewed and explicitly approved the preview. Requires user_confirmed=true, validates the structured fields and payment method, then saves to SQLite; Google Sheets is updated asynchronously by the existing sync worker. Reuse the same idempotency_key when retrying.",
      inputSchema: receiptRecordInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      try {
        const result = await application.recordReceipt(input, "mcp");
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  const emptySchema = fromJsonSchema({ type: "object", properties: {}, additionalProperties: false });
  const previewSchema = fromJsonSchema({ type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 4000 }, idempotency_key: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } }, required: ["text", "idempotency_key"], additionalProperties: false });
  const confirmSchema = fromJsonSchema({ type: "object", properties: { token: { type: "string", minLength: 1, maxLength: 128 }, user_confirmed: { type: "boolean", const: true } }, required: ["token", "user_confirmed"], additionalProperties: false });
  const previews = z.object({ text: z.string().min(1).max(4000), idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();
  const confirmations = z.object({ token: z.string().min(1).max(128), user_confirmed: z.literal(true) }).strict();
  const wealthImageSchema = fromJsonSchema({ type: "object", properties: { media_base64: { type: "string", minLength: 32, maxLength: MAX_MEDIA_BASE64_LENGTH }, mime_type: { type: "string", minLength: 3, maxLength: 128 }, caption: { type: "string", maxLength: 2000 }, idempotency_key: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } }, required: ["media_base64", "mime_type", "idempotency_key"], additionalProperties: false });
  const wishlistSchema = fromJsonSchema({ type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 4000 }, chat_id: { type: "string", minLength: 1, maxLength: 128 }, source_platform: { type: "string", minLength: 1, maxLength: 32 } }, required: ["text", "chat_id"], additionalProperties: false });
  const wealthImages = z.object({ media_base64: z.string().min(32).max(MAX_MEDIA_BASE64_LENGTH), mime_type: z.string().min(3).max(128), caption: z.string().max(2000).optional(), idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();
  const wishlists = z.object({ text: z.string().min(1).max(4000), chat_id: z.string().min(1).max(128), source_platform: z.string().min(1).max(32).optional() }).strict();
  const tools = [
    { name: "get_finance_budget", description: "Read current budget status from the configured Google Sheet without changing it.", schema: emptySchema, readOnly: true, run: async () => (await import("../../application/finance-tools.js")).budgetStatus() },
    { name: "get_finance_digest", description: "Read weekly spend and payment calendar summary from the configured Google Sheet.", schema: emptySchema, readOnly: true, run: async () => (await import("../../application/finance-tools.js")).financeDigest() },
    { name: "preview_finance_cicilan", description: "Parse installment text and return an unsaved preview and confirmation token. Use a stable idempotency_key.", schema: previewSchema, readOnly: true, run: async (input: unknown) => { const v = previews.parse(input); return (await import("../../application/finance-tools.js")).previewCicilan(v.text, v.idempotency_key); } },
    { name: "confirm_finance_cicilan", description: "Save a previewed installment to Google Sheets only after explicit user approval. Confirmation tokens expire and do not survive a restart.", schema: confirmSchema, readOnly: false, run: async (input: unknown) => { const v = confirmations.parse(input); return (await import("../../application/finance-tools.js")).confirmCicilan(v.token); } },
    { name: "preview_finance_wealth", description: "Parse a text wealth snapshot and return an unsaved preview and confirmation token. Use a stable idempotency_key.", schema: previewSchema, readOnly: true, run: async (input: unknown) => { const v = previews.parse(input); return (await import("../../application/finance-tools.js")).previewWealth(v.text, v.idempotency_key); } },
    { name: "confirm_finance_wealth", description: "Save a previewed wealth snapshot to Google Sheets only after explicit user approval. Confirmation tokens expire and do not survive a restart.", schema: confirmSchema, readOnly: false, run: async (input: unknown) => { const v = confirmations.parse(input); return (await import("../../application/finance-tools.js")).confirmWealth(v.token); } },
    { name: "parse_finance_wealth_image", description: "Parse a wealth snapshot out of a base64 image or single-page PDF and return an unsaved preview plus a confirmation token. Confirm with confirm_finance_wealth. Requires MISTRAL_API_KEY; PDF input also requires RECEIPT_ACCEPT_PDF and the poppler pdftoppm binary.", schema: wealthImageSchema, readOnly: true, run: async (input: unknown) => { const v = wealthImages.parse(input); return (await import("../../application/finance-tools.js")).wealthImage(v); } },
    { name: "run_wishlist_command", description: "Run a wishlist board command (show, add, done, undone) against the Markdown memory vault and commit the change. Only chats listed in WISHLIST_ALLOWED_GROUPS are accepted.", schema: wishlistSchema, readOnly: false, run: async (input: unknown) => { const v = wishlists.parse(input); return (await import("../../application/finance-tools.js")).wishlistCommand(v); } },
    { name: "get_model_health", description: "Check connectivity and latency of the configured receipt parsing model without changing any data.", schema: emptySchema, readOnly: true, run: async () => (await import("../../application/finance-tools.js")).modelHealth() }
  ];
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, idempotentHint: tool.readOnly, openWorldHint: true }
    }, async (input: unknown) => {
      try {
        const result = await tool.run(input);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return toolError(error);
      }
    });
  }

  return server;
}

export function createFinanceMcpHandler(application: FinanceApplication) {
  return createMcpHandler(() => createFinanceMcpServer(application), {
    maxRequestBodySize: MAX_MCP_REQUEST_BODY_BYTES
  });
}

function toolError(error: unknown) {
  const message = error instanceof FinanceValidationError ? error.message : "Finance request could not be processed.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }]
  };
}

function toMcpInputSchema(schema: typeof FinanceReceiptInputSchema) {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any" });
  const schemaWithRequired = jsonSchema as typeof jsonSchema & { required?: string[] };
  const defaultedFields = new Set(["tax_amount", "tax_label_raw", "currency"]);
  if (schemaWithRequired.required) {
    schemaWithRequired.required = schemaWithRequired.required.filter((field) => !defaultedFields.has(field));
  }
  return fromJsonSchema(jsonSchema as Parameters<typeof fromJsonSchema>[0]);
}
