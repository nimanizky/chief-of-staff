import assert from "node:assert/strict";

// Dummy values satisfy config validation; this test makes no external calls.
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/test-credentials.json";
process.env.RECEIPT_SPREADSHEET_ID = "offline-test";
process.env.RECEIPT_JOURNAL_PATH = "/nonexistent/test-journal.md";

const { default: taskGate } = await import("../../plugins/task-gate/index.js");

const handlers = new Map();
taskGate.register({
  on(name, handler) { handlers.set(name, handler); },
  logger: { info() {} }
});

const whatsapp = { channelId: "whatsapp", messageProvider: "whatsapp" };
const telegram = { channelId: "telegram", messageProvider: "telegram" };
const mediaEvent = { body: "/receipt", media: [{ url: "https://example.com/receipt.jpg" }] };

process.env.OPENCLAW_GENERAL_WHATSAPP = "true";
assert.equal(await handlers.get("before_dispatch")({ channel: "whatsapp", body: "show wishlist" }, whatsapp), undefined);
assert.equal(handlers.get("before_agent_reply")(mediaEvent, whatsapp), undefined);
assert.equal(handlers.get("before_agent_reply")(mediaEvent, telegram)?.handled, true);

const { default: taskRouterHook } = await import("../../hooks/task-router/handler.ts");
const whatsappEvent = {
  type: "message",
  action: "preprocessed",
  context: { channelId: "whatsapp", bodyForAgent: "/receipt" },
  messages: []
};
await taskRouterHook(whatsappEvent);
assert.equal(whatsappEvent.context.bodyForAgent, "/receipt");
assert.deepEqual(whatsappEvent.messages, []);

process.env.OPENCLAW_GENERAL_WHATSAPP = "false";
assert.equal(handlers.get("before_agent_reply")(mediaEvent, whatsapp)?.handled, true);
console.log("General WhatsApp dispatch checks passed.");
