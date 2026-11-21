import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenClawAdapter } from "./openclaw.mjs";
import { createWorkspaceAdapter } from "./workspace.mjs";
import { createSyncAdapter } from "./sync.mjs";
import { createAuthChallenge, createJwtVerifier, OAuthError } from "./auth.mjs";

const SUPPORTED_PROTOCOLS = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);
const MAX_NOTE_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 320 * 1024;
const MAX_MESSAGE_LENGTH = 4_000;

function jsonSchema(type, properties = {}, required = []) {
  return { type, properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function createToolDefinitions({ readScope = "openclaw.read", writeScope = "openclaw.write" } = {}) {
  const readSecurity = { securitySchemes: [{ type: "oauth2", scopes: [readScope] }] };
  const writeSecurity = { securitySchemes: [{ type: "oauth2", scopes: [writeScope] }] };
  const readWriteSecurity = { securitySchemes: [{ type: "oauth2", scopes: [readScope, writeScope] }] };
  return [
    {
      name: "whatsapp_list_groups",
      title: "List WhatsApp group chats",
      description: "List WhatsApp group sessions currently known to OpenClaw. Only groups with an existing OpenClaw session are returned; this is not a complete export of every WhatsApp group on the linked phone.",
      inputSchema: jsonSchema("object"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: readSecurity
    },
    {
      name: "whatsapp_read_group_messages",
      title: "Read WhatsApp group messages",
      description: "Read recent messages from the OpenClaw transcript for one known WhatsApp group. This returns messages retained in the OpenClaw session, not a guaranteed complete raw WhatsApp export. If multiple sessions exist, provide agent_id and account_id from whatsapp_list_groups.",
      inputSchema: jsonSchema("object", {
        group_jid: { type: "string", pattern: "^[0-9]{5,}(?:-[0-9]{5,})?@g\\.us$" },
        agent_id: { type: "string" },
        account_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
      }, ["group_jid"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: readSecurity
    },
    {
      name: "whatsapp_send_group_message",
      title: "Send a WhatsApp group message",
      description: "Send a text message to an existing WhatsApp group known to OpenClaw. This is externally visible. Confirm the exact recipient and message with the user before calling this tool. Provide agent_id/account_id when the group has multiple sessions.",
      inputSchema: jsonSchema("object", {
        group_jid: { type: "string", pattern: "^[0-9]{5,}(?:-[0-9]{5,})?@g\\.us$" },
        message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        agent_id: { type: "string" },
        account_id: { type: "string" }
      }, ["group_jid", "message"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: readWriteSecurity
    },
    {
      name: "workspace_list_notes",
      title: "List Obsidian workspace notes",
      description: "List Markdown notes in the persistent OpenClaw workspace, which is synchronized to the configured Obsidian vault by the background memory-sync service.",
      inputSchema: jsonSchema("object", {
        prefix: { type: "string", maxLength: 256 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: readSecurity
    },
    {
      name: "workspace_read_note",
      title: "Read an Obsidian note",
      description: "Read a Markdown note from the persistent OpenClaw workspace. Paths are relative to the workspace root; hidden/configuration directories and symlinks are not accessible.",
      inputSchema: jsonSchema("object", { path: { type: "string", minLength: 1, maxLength: 512 } }, ["path"]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: readSecurity
    },
    {
      name: "workspace_write_note",
      title: "Save an Obsidian note",
      description: "Create or explicitly overwrite a Markdown note in the persistent OpenClaw workspace. The background memory-sync service commits and pushes workspace changes to the configured Obsidian vault. Existing notes are never overwritten unless overwrite=true is explicitly supplied.",
      inputSchema: jsonSchema("object", {
        path: { type: "string", minLength: 1, maxLength: 512 },
        content: { type: "string", maxLength: MAX_NOTE_BYTES },
        overwrite: { type: "boolean", default: false }
      }, ["path", "content"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      _meta: writeSecurity
    }
,
    {
      name: "workspace_sync",
      title: "Sync OpenClaw workspace to Obsidian now",
      description: "Dispatch the existing GitHub Actions workflow to sync the persistent OpenClaw workspace with the private Obsidian vault. This queues a sync and returns immediately; check GitHub Actions for the final result. Call only when the user explicitly asks to sync now. The background sync worker continues to run independently.",
      inputSchema: jsonSchema("object"),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: writeSecurity
    }  ];
}

export function createMcpHttpServer({
  config = process.env,
  gateway = createOpenClawAdapter(),
  workspace = createWorkspaceAdapter(),
  sync = null,
  verifyToken = createJwtVerifier({
    issuer: config.MCP_OAUTH_ISSUER,
    jwksUrl: config.MCP_OAUTH_JWKS_URL,
    audience: config.MCP_OAUTH_AUDIENCE
  })
} = {}) {
  const publicUrl = config.MCP_PUBLIC_URL;
  const issuer = config.MCP_OAUTH_ISSUER;
  const readScope = config.MCP_OAUTH_SCOPE_READ || "openclaw.read";
  const writeScope = config.MCP_OAUTH_SCOPE_WRITE || "openclaw.write";
  const tools = createToolDefinitions({ readScope, writeScope });
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const syncAdapter = sync || createSyncAdapter({
    token: config.MCP_SYNC_GITHUB_TOKEN,
    repository: config.MCP_SYNC_GITHUB_REPOSITORY,
    workflow: config.MCP_SYNC_GITHUB_WORKFLOW,
    ref: config.MCP_SYNC_GITHUB_REF
  });

  return createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      sendJson(response, 500, { error: "internal_error", message: "The MCP request could not be processed." });
      console.error("[openclaw-mcp] request failed:", error?.message || error);
    });
  });

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://mcp.local");
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      sendJson(response, 200, {
        resource: publicUrl,
        authorization_servers: [issuer],
        scopes_supported: [readScope, writeScope],
        bearer_methods_supported: ["header"]
      });
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    if (request.method === "GET") {
      response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST", "Cache-Control": "no-store" });
      response.end();
      return;
    }

    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      sendJson(response, 415, { error: "unsupported_media_type" });
      return;
    }
    const accept = request.headers.accept || "*/*";
    if (!accept.includes("application/json") && !accept.includes("text/event-stream") && !accept.includes("*/*")) {
      sendJson(response, 406, { error: "not_acceptable" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.code || "invalid_request", message: error.message });
      return;
    }
    const protocolHeader = request.headers["mcp-protocol-version"];
    const requestedProtocol = body?.params?.protocolVersion;
    const protocolVersion = protocolHeader || (typeof requestedProtocol === "string" ? requestedProtocol : "2025-03-26");
    if (!SUPPORTED_PROTOCOLS.has(protocolVersion)) {
      sendJson(response, 400, { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32602, message: "Unsupported MCP protocol version." } });
      return;
    }

    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
      sendJson(response, 400, { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(body, "id");
    if (!hasId) {
      if (body.method.startsWith("notifications/")) {
        response.writeHead(202, { "Cache-Control": "no-store", "MCP-Protocol-Version": protocolVersion });
        response.end();
        return;
      }
      sendJson(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "JSON-RPC requests must include an id; only notifications may omit it." } });
      return;
    }

    try {
      const result = await dispatch(body, request);
      sendJson(response, 200, { jsonrpc: "2.0", id: body.id, result }, { "MCP-Protocol-Version": protocolVersion });
    } catch (error) {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32603, message: error.message || "Internal error." }
      }, { "MCP-Protocol-Version": protocolVersion });
    }
  }

  async function dispatch(body, request) {
    switch (body.method) {
      case "initialize": {
        const requested = body.params?.protocolVersion;
        if (typeof requested === "string" && !SUPPORTED_PROTOCOLS.has(requested)) {
          throw new Error("The requested MCP protocol version is not supported.");
        }
        return {
          protocolVersion: requested || "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "chief-of-staff-openclaw", version: "1.0.0" },
          instructions: "Use WhatsApp tools to read OpenClaw group session transcripts and send approved messages. Use workspace tools to read and save Markdown notes in the persistent Obsidian-synced workspace. Call workspace_sync only when the user explicitly asks to sync now; it dispatches the same GitHub Actions workflow available for manual runs. Message history is limited to what OpenClaw retained in its session transcript."
        };
      }
      case "notifications/initialized":
      case "ping":
        return {};
      case "tools/list":
        return { tools };
      case "tools/call":
        return callTool(body.params || {}, request);
      case "resources/list":
        return { resources: [] };
      case "prompts/list":
        return { prompts: [] };
      default:
        throw new Error(`Unsupported MCP method: ${body.method}`);
    }
  }

  async function callTool(params, request) {
    const name = params.name;
    const tool = toolByName.get(name);
    if (!tool) return toolError(`Unknown tool: ${String(name)}`);
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
    const requiredScopes = tool._meta.securitySchemes[0].scopes;
    const authorization = request.headers.authorization || "";
    const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization);
    try {
      if (!tokenMatch) throw new OAuthError("invalid_token", "No OAuth access token was provided.");
      const identity = await verifyToken(tokenMatch[1], requiredScopes);
      if (identity.subject !== config.MCP_OAUTH_ALLOWED_SUBJECT) {
        throw new OAuthError("insufficient_scope", "This OAuth account is not authorized for this personal OpenClaw server.", requiredScopes.join(" "));
      }
    } catch (error) {
      if (error instanceof OAuthError) {
        const challenge = createAuthChallenge({
          publicUrl,
          error: error.code,
          description: error.message,
          scope: error.requiredScope || requiredScopes.join(" ")
        });
        return {
          isError: true,
          content: [{ type: "text", text: error.message }],
          _meta: { "mcp/www_authenticate": [challenge] }
        };
      }
      return toolError("The OAuth access token could not be verified. Try reconnecting the app.");
    }

    try {
      let result;
      switch (name) {
        case "whatsapp_list_groups":
          result = { groups: await gateway.listWhatsAppGroups() };
          break;
        case "whatsapp_read_group_messages":
          result = await gateway.readWhatsAppGroupMessages({
            groupJid: requiredString(args.group_jid, "group_jid"),
            agentId: optionalString(args.agent_id),
            accountId: optionalString(args.account_id),
            limit: boundedInteger(args.limit, 50, 1, 100, "limit")
          });
          break;
        case "whatsapp_send_group_message":
          result = await gateway.sendWhatsAppGroupMessage({
            groupJid: requiredString(args.group_jid, "group_jid"),
            agentId: optionalString(args.agent_id),
            accountId: optionalString(args.account_id),
            message: requiredString(args.message, "message", MAX_MESSAGE_LENGTH)
          });
          break;
        case "workspace_list_notes":
          result = await workspace.listNotes({
            prefix: optionalString(args.prefix) || "",
            limit: boundedInteger(args.limit, 100, 1, 500, "limit")
          });
          break;
        case "workspace_read_note":
          result = await workspace.readNote({ path: requiredString(args.path, "path", 512) });
          break;
        case "workspace_write_note":
          if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") {
            throw new Error("overwrite must be a boolean.");
          }
          result = await workspace.writeNote({
            path: requiredString(args.path, "path", 512),
            content: requiredString(args.content, "content", MAX_NOTE_BYTES, true),
            overwrite: args.overwrite === true
          });
          break;
        case "workspace_sync":
          result = await syncAdapter.triggerSync();
          break;
        default:
          return toolError(`Tool handler is not implemented: ${name}`);
      }
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result
      };
    } catch (error) {
      return toolError(error.message || "The tool operation failed.");
    }
  }
}

function requiredString(value, field, maxLength = 512, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maxLength) {
    throw new Error(`${field} must be a ${allowEmpty ? "string" : "non-empty string"} of at most ${maxLength} characters.`);
  }
  return value;
}

function optionalString(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 256) throw new Error("Optional string arguments must be strings of at most 256 characters.");
  return value;
}

function boundedInteger(value, fallback, min, max, field) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  return value;
}

function toolError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      error.statusCode = 413;
      error.code = "payload_too_large";
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function validateStartupConfig(env) {
  for (const [key, value] of [
    ["MCP_PUBLIC_URL", env.MCP_PUBLIC_URL],
    ["MCP_OAUTH_ISSUER", env.MCP_OAUTH_ISSUER],
    ["MCP_OAUTH_JWKS_URL", env.MCP_OAUTH_JWKS_URL],
    ["MCP_OAUTH_AUDIENCE", env.MCP_OAUTH_AUDIENCE],
    ["MCP_OAUTH_ALLOWED_SUBJECT", env.MCP_OAUTH_ALLOWED_SUBJECT]
  ]) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required when MCP_SERVER_ENABLED=true.`);
    if (key === "MCP_OAUTH_ALLOWED_SUBJECT") continue;
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${key} must be an HTTPS URL without embedded credentials.`);
    if (key === "MCP_PUBLIC_URL" && (parsed.pathname !== "/" || parsed.search || parsed.hash)) {
      throw new Error("MCP_PUBLIC_URL must be the public HTTPS origin without a path, query, or fragment.");
    }
  }
  if (env.MCP_OAUTH_AUDIENCE !== env.MCP_PUBLIC_URL) {
    throw new Error("MCP_OAUTH_AUDIENCE must exactly match MCP_PUBLIC_URL.");
  }
}

export function startMcpServer(env = process.env) {
  validateStartupConfig(env);
  const host = env.MCP_BIND_HOST || "127.0.0.1";
  const port = Number(env.MCP_PORT || 3200);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MCP_PORT must be a valid TCP port.");
  const server = createMcpHttpServer({ config: env });
  server.listen(port, host, () => console.log(`[openclaw-mcp] listening on ${host}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const enabled = ["1", "true", "yes", "on"].includes(process.env.MCP_SERVER_ENABLED?.trim().toLowerCase() || "");
  if (enabled) startMcpServer();
  else console.log("[openclaw-mcp] disabled; set MCP_SERVER_ENABLED=true to start the ChatGPT-facing MCP endpoint.");
}
