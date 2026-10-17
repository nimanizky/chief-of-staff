import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
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

  return server;
}

export function createFinanceMcpHandler(application: FinanceApplication) {
  return createMcpHandler(() => createFinanceMcpServer(application), {
    maxRequestBodySize: 64 * 1024
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
