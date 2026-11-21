import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { FinanceApplication } from "../../application/finance-application.js";
import { FinancePersistenceError, FinanceValidationError } from "../../application/finance-application.js";
import { createFinanceMcpHandler } from "../mcp/finance-mcp-server.js";

const MAX_REQUEST_BYTES = 64 * 1024;

export function createFinanceHttpServer(application: FinanceApplication, bearerToken: string): Server {
  const expectedToken = validateBearerToken(bearerToken);
  const mcpHandler = toNodeHandler(createFinanceMcpHandler(application), {
    maxRequestBodySize: MAX_REQUEST_BYTES,
    onerror: (error) => console.error("[finance-mcp] request adapter failed:", error.message)
  });

  return createServer((request, response) => {
    void routeRequest(request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      handleFinanceHttpError(response, error);
      if (!(error instanceof HttpRequestError || error instanceof FinanceValidationError || error instanceof FinancePersistenceError)) {
        console.error("[finance-api] unhandled request error:", error);
      }
    });
  });

  async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", "http://finance.local");
    const path = requestUrl.pathname;

    if (request.method === "GET" && path === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (!isAuthorized(request, expectedToken)) {
      response.setHeader("WWW-Authenticate", "Bearer realm=\"chief-of-staff-finance\"");
      sendError(response, 401, "unauthorized", "A valid bearer token is required.");
      return;
    }

    if (path === "/mcp") {
      await mcpHandler(request, response);
      return;
    }

    if (request.method === "GET" && path === "/api/v1/finance/payment-methods") {
      sendJson(response, 200, { payment_methods: application.paymentMethods });
      return;
    }

    if (request.method === "POST" && path === "/api/v1/finance/receipts/preview") {
      const body = await readJsonBody(request);
      const preview = application.previewReceipt(body, "http_api");
      sendJson(response, 200, preview);
      return;
    }

    if (request.method === "POST" && path === "/api/v1/finance/receipts") {
      const body = await readJsonBody(request);
      const result = await application.recordReceipt(body, "http_api");
      sendJson(response, result.storage_status === "duplicate" ? 200 : 201, result);
      return;
    }

    sendError(response, 404, "not_found", "No Finance API route matches this request.");
  }
}

function validateBearerToken(token: string): Buffer {
  const normalized = token.trim();
  if (normalized.length < 32) {
    throw new Error("FINANCE_API_TOKEN must contain at least 32 characters when the Finance API is enabled.");
  }
  return Buffer.from(normalized, "utf8");
}

function isAuthorized(request: IncomingMessage, expectedToken: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return false;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match?.[1]) return false;

  const providedToken = Buffer.from(match[1], "utf8");
  return providedToken.length === expectedToken.length && timingSafeEqual(providedToken, expectedToken);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpRequestError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }

  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new HttpRequestError(413, "payload_too_large", "Request body exceeds 64 KiB.");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new HttpRequestError(413, "payload_too_large", "Request body exceeds 64 KiB.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpRequestError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string): void {
  sendJson(response, statusCode, { error: { code, message } });
}

class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function handleFinanceHttpError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpRequestError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof FinanceValidationError) {
    sendError(response, 400, "validation_error", error.message);
    return;
  }
  if (error instanceof FinancePersistenceError) {
    sendError(response, 503, "storage_unavailable", error.message);
    return;
  }
  sendError(response, 500, "internal_error", "The request could not be processed.");
}
