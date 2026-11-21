import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHttpServer } from "./server.mjs";
import { createOpenClawAdapter, parseWhatsAppGroupSession } from "./openclaw.mjs";
import { createWorkspaceAdapter } from "./workspace.mjs";
import { createJwtVerifier } from "./auth.mjs";
import { generateKeyPairSync, sign } from "node:crypto";

const groupJid = "120363123456789-123456789012345@g.us";
const groupRow = {
  key: `agent:main:whatsapp:group:${groupJid}`,
  channel: "whatsapp",
  chatType: "group",
  displayName: "Wedding group",
  lastMessagePreview: "RSVP confirmed",
  lastInteractionAt: 1234
};

assert.equal(parseWhatsAppGroupSession(groupRow).group_jid, groupJid);
assert.equal(parseWhatsAppGroupSession({ ...groupRow, channel: "telegram" }), null);
assert.equal(parseWhatsAppGroupSession({ ...groupRow, key: "agent:main:whatsapp:direct:628123456789" }), null);

const gatewayCalls = [];
const cliCalls = [];
const adapter = createOpenClawAdapter({
  runCli: async (args) => {
    cliCalls.push(args);
    if (args[0] === "gateway" && args[2] === "sessions.list") {
      return { sessions: [groupRow], hasMore: false };
    }
    if (args[0] === "gateway" && args[2] === "chat.history") {
      gatewayCalls.push(JSON.parse(args[4]));
      return { messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] };
    }
    return { ok: true, messageId: "sent-1" };
  }
});
const groups = await adapter.listWhatsAppGroups();
assert.equal(groups.length, 1);
assert.equal(groups[0].name, "Wedding group");
const history = await adapter.readWhatsAppGroupMessages({ groupJid, limit: 10 });
assert.equal(history.messages.length, 1);
assert.equal(gatewayCalls[0].sessionKey, groupRow.key);
const sent = await adapter.sendWhatsAppGroupMessage({ groupJid, message: "Test message" });
assert.equal(sent.sent, true);
assert.ok(cliCalls.at(-1).includes("--target"));
assert.ok(cliCalls.at(-1).includes(groupJid));

const tempRoot = await mkdtemp(join(tmpdir(), "openclaw-mcp-test-"));
try {
  const workspace = createWorkspaceAdapter({ root: tempRoot });
  const saved = await workspace.writeNote({ path: "memory/test-note.md", content: "# Hello\n" });
  assert.equal(saved.saved, true);
  const read = await workspace.readNote({ path: "memory/test-note.md" });
  assert.equal(read.content, "# Hello\n");
  await assert.rejects(() => workspace.writeNote({ path: "memory/test-note.md", content: "replace" }), /already exists/);
  const replaced = await workspace.writeNote({ path: "memory/test-note.md", content: "# Updated\n", overwrite: true });
  assert.equal(replaced.overwritten, true);
  assert.equal((await workspace.readNote({ path: "memory/test-note.md" })).content, "# Updated\n");
  await assert.rejects(() => workspace.readNote({ path: "../outside.md" }), /invalid|outside/i);
  await mkdir(join(tempRoot, "linked"));
  await writeFile(join(tempRoot, "target.md"), "secret");
  await rm(join(tempRoot, "linked"), { recursive: true, force: true });
  await symlink(join(tempRoot, "memory"), join(tempRoot, "linked"), "dir");
  await assert.rejects(() => workspace.readNote({ path: "linked/test-note.md" }), /Symbolic links/);
  const listing = await workspace.listNotes({ limit: 10 });
  assert.equal(listing.notes.length, 2);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

// Verify JWT signature, issuer, audience, expiry, and scope enforcement without a real IdP.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.use = "sig";
jwk.alg = "RS256";
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwtHeader = base64url({ alg: "RS256", kid: "test-key", typ: "JWT" });
const jwtPayload = base64url({ iss: "https://issuer.example/", aud: "https://mcp.example.com", sub: "user-1", exp: Math.floor(Date.now() / 1000) + 300, scope: "openclaw.read openclaw.write" });
const signingInput = `${jwtHeader}.${jwtPayload}`;
const jwtSignature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
const token = `${signingInput}.${jwtSignature}`;
const verifier = createJwtVerifier({
  issuer: "https://issuer.example/",
  jwksUrl: "https://issuer.example/.well-known/jwks.json",
  audience: "https://mcp.example.com",
  fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })
});
const identity = await verifier(token, ["openclaw.read"]);
assert.equal(identity.subject, "user-1");
await assert.rejects(() => verifier(token, ["admin"]), /missing required scope/);

// Exercise the Streamable HTTP JSON-RPC surface and OAuth challenge metadata.
const httpServer = createMcpHttpServer({
  config: {
    MCP_PUBLIC_URL: "https://mcp.example.com",
    MCP_OAUTH_ISSUER: "https://issuer.example/",
    MCP_OAUTH_ALLOWED_SUBJECT: "user-1",
    MCP_OAUTH_SCOPE_READ: "openclaw.read",
    MCP_OAUTH_SCOPE_WRITE: "openclaw.write"
  },
  gateway: { listWhatsAppGroups: async () => [{ group_jid: groupJid }] },
  workspace: { listNotes: async () => ({ notes: [], count: 0, limit: 10 }) },
  verifyToken: async (value, scopes) => {
    if (value !== "good-token" && value !== "wrong-user-token") throw new Error("bad token");
    return { subject: value === "good-token" ? "user-1" : "user-2", scopes: new Set(scopes) };
  }
});
await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
try {
  const address = httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  const initialized = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
  });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.serverInfo.name, "chief-of-staff-openclaw");

  const listed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });
  const listBody = await listed.json();
  assert.equal(listBody.result.tools.length, 6);
  assert.equal(listBody.result.tools.find((tool) => tool.name === "whatsapp_send_group_message")._meta.securitySchemes[0].type, "oauth2");

  const unauthorized = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whatsapp_list_groups", arguments: {} } })
  });
  const unauthorizedBody = await unauthorized.json();
  assert.equal(unauthorizedBody.result.isError, true);
  assert.match(unauthorizedBody.result._meta["mcp/www_authenticate"][0], /oauth-protected-resource/);

  const wrongUser = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer wrong-user-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "whatsapp_list_groups", arguments: {} } })
  });
  const wrongUserBody = await wrongUser.json();
  assert.equal(wrongUserBody.result.isError, true);
  assert.match(wrongUserBody.result._meta["mcp/www_authenticate"][0], /insufficient_scope/);

  const authorized = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "whatsapp_list_groups", arguments: {} } })
  });
  const authorizedBody = await authorized.json();
  assert.equal(authorizedBody.result.structuredContent.groups[0].group_jid, groupJid);

  const notificationCall = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer good-token" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "whatsapp_list_groups", arguments: {} } })
  });
  assert.equal(notificationCall.status, 400);

  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, "https://mcp.example.com");
} finally {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
}

console.log("OpenClaw MCP tests passed.");
