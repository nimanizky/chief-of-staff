import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  processWishlistAssistant,
  processWishlistToolAction
} from "../../dist/usecases/wishlist-assistant/process-wishlist-assistant.js";

const RECEIPT_COMMAND_RE = /^\/receipt(?:@\w+)?(?:\s|$)/i;
const INCOME_COMMAND_RE = /^\/income(?:@\w+)?(?:\s|$)/i;
const GYM_COMMAND_RE = /^\/gym(?:@\w+)?(?:\s|$)/i;
const MODELHEALTH_COMMAND_RE = /^\/modelhealth(?:\s|$)/i;
const BUDGET_COMMAND_RE = /(?:^|\s)(?:\/budget(?:@\w+)?|budget\s+(?:status|check))(?:\s|$)/i;
const CONFIRMATION_RE =
  /^(?:callback_data:\s*)?(?:receipt_(?:confirm|reject):[A-Za-z0-9_-]+|receipt_method:[A-Za-z0-9_-]+:[a-z0-9-]+|\/receipt_(?:confirm|reject)\s+[A-Za-z0-9_-]+|\/receipt_method\s+[A-Za-z0-9_-]+\s+[a-z0-9-]+)$/i;
const NO_REPLY_RE = /^NO_REPLY$/i;
const MD_BOT_REPLY_RE = /^\[md-bot\]\s+/i;
const MEDIA_PLACEHOLDER_RE = /^<media:[^>]+>(?:\s*\([^)]*\))?$/i;

function textFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasMediaValue(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value !== "object") return false;

  return [
    value.media,
    value.attachment,
    value.attachments,
    value.mediaUrl,
    value.attachmentUrl,
    value.fileUrl,
    value.downloadUrl,
    value.filePath,
    value.mediaPath,
    value.url
  ].some(hasMediaValue);
}

function hasTaskMedia(event) {
  return [
    event?.media,
    event?.attachment,
    event?.attachments,
    event?.context?.media,
    event?.context?.attachment,
    event?.context?.attachments,
    event?.context?.metadata?.media,
    event?.context?.metadata?.mediaUrl,
    event?.context?.metadata?.attachmentUrl,
    event?.context?.metadata?.fileUrl,
    event?.context?.metadata?.attachments
  ].some(hasMediaValue);
}

function shouldSilence(event) {
  const textCandidates = [
    textFrom(event?.cleanedBody),
    textFrom(event?.body),
    textFrom(event?.bodyForAgent),
    textFrom(event?.content),
    textFrom(event?.context?.bodyForAgent),
    textFrom(event?.context?.bodyForCommands),
    textFrom(event?.context?.content),
    textFrom(event?.context?.text),
    textFrom(event?.context?.body),
    textFrom(event?.context?.rawBody),
    textFrom(event?.context?.commandBody),
    textFrom(event?.context?.transcript)
  ].filter(Boolean);
  const hasMedia = hasTaskMedia(event) || textCandidates.some((candidate) => MEDIA_PLACEHOLDER_RE.test(candidate));

  if (textCandidates.some((candidate) => NO_REPLY_RE.test(candidate))) return "task_no_reply_marker";

  const text = textCandidates[0];
  if (!text) return hasMedia ? "task_media" : null;
  if (MEDIA_PLACEHOLDER_RE.test(text)) return "task_media";
  if (RECEIPT_COMMAND_RE.test(text)) return hasMedia ? "receipt_command" : "receipt_missing_media";
  if (INCOME_COMMAND_RE.test(text)) return hasMedia ? "income_command" : "income_missing_media";
  if (GYM_COMMAND_RE.test(text)) return hasMedia ? "gym_command" : "gym_missing_media";
  if (MODELHEALTH_COMMAND_RE.test(text)) return "modelhealth_command";
  if (BUDGET_COMMAND_RE.test(text)) return "budget_command";
  if (CONFIRMATION_RE.test(text)) return "receipt_confirmation";
  if (hasMedia) return "task_media";
  return null;
}

function syntheticTaskReply(event) {
  const messageCandidates = Array.isArray(event?.messages)
    ? event.messages.map(textFrom).filter(Boolean)
    : [];
  return messageCandidates.find((candidate) => MD_BOT_REPLY_RE.test(candidate)) ?? null;
}

function deterministicReplyInstruction(text) {
  return [
    "A deterministic local task already handled this message.",
    "Your complete final answer must be exactly the text inside <exact_reply>.",
    "Do not paraphrase, summarize, translate, add, remove, or reformat anything.",
    "",
    "<exact_reply>",
    text,
    "</exact_reply>"
  ].join("\n");
}

function whatsappGroupIdFrom(event, ctx) {
  const candidates = [
    ctx?.conversationId,
    event?.conversationId,
    event?.sessionKey,
    ctx?.sessionKey
  ].filter(Boolean);

  for (const candidate of candidates) {
    const raw = String(candidate).trim();
    const group = raw.match(/(\d+@g\.us)/i)?.[1];
    if (group) return group;
  }

  return "";
}

function dispatchTextFrom(event) {
  return textFrom(event?.body) || textFrom(event?.content);
}

function wishlistFilePath() {
  const explicit = textFrom(process.env.WISHLIST_FILE_PATH);
  if (explicit) return explicit;
  const vaultPath = textFrom(process.env.OPENCLAW_MEMORY_VAULT_PATH);
  return vaultPath ? join(vaultPath, "memory", "wishlists", "backlog-wishlist.md") : "";
}

function readWishlistContent() {
  const filePath = wishlistFilePath();
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    return "";
  }
}

function compactContextText(value, maxChars = 30000) {
  const text = textFrom(value);
  if (text.length <= maxChars) return text;
  return `[truncated: showing last ${maxChars} chars]\n${text.slice(-maxChars)}`;
}

function messageTextFrom(value, depth = 0, seen = new WeakSet()) {
  if (!value || depth > 6) return "";
  if (typeof value === "string") return textFrom(value);
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const direct = [
    value.text,
    value.body,
    value.content,
    value.caption,
    value.conversation,
    value.extendedTextMessage?.text,
    value.imageMessage?.caption,
    value.videoMessage?.caption,
    value.documentMessage?.caption,
    value.buttonsResponseMessage?.selectedDisplayText,
    value.listResponseMessage?.title
  ].map(textFrom).find(Boolean);
  if (direct) return direct;

  for (const candidate of Object.values(value)) {
    const nested = messageTextFrom(candidate, depth + 1, seen);
    if (nested) return nested;
  }

  return "";
}

function findQuotedTextDeep(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || depth > 7) return "";
  if (seen.has(value)) return "";
  seen.add(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (/quoted|reply|contextInfo/i.test(key)) {
      const text = messageTextFrom(nestedValue, depth + 1, seen);
      if (text) return text;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const text = findQuotedTextDeep(nestedValue, depth + 1, seen);
    if (text) return text;
  }

  return "";
}

function quotedTextFrom(event) {
  const candidates = [
    event?.quotedText,
    event?.quotedBody,
    event?.quotedMessage,
    event?.replyTo,
    event?.context?.quotedText,
    event?.context?.quotedBody,
    event?.context?.quotedMessage,
    event?.context?.replyTo,
    event?.context?.metadata?.quotedText,
    event?.context?.metadata?.quotedBody,
    event?.context?.metadata?.quotedMessage,
    event?.context?.metadata?.replyTo,
    event?.context?.raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage,
    event?.context?.rawMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage,
    event?.raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage,
    event?.rawMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage
  ];

  const direct = candidates.map(messageTextFrom).find(Boolean);
  return direct || findQuotedTextDeep(event);
}

function looksPossiblyWishlistRequest(text) {
  return /\b(?:wishlist|wish|backlog|list|show|add|save|store|put|import|done|undone|mark|ykc|jkt|action)\b/i.test(
    text
  );
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function wishlistMode() {
  const raw = String(process.env.WISHLIST_MODE ?? "").trim().toLowerCase();
  if (["deterministic", "tool", "hybrid", "legacy"].includes(raw)) return raw;
  return envBool("WISHLIST_EXACT_DISPATCH", true) ? "deterministic" : "legacy";
}

function modeUsesDeterministic() {
  const mode = wishlistMode();
  return mode === "deterministic" || mode === "hybrid";
}

function modeUsesTool() {
  const mode = wishlistMode();
  return mode === "tool" || mode === "hybrid";
}

function chatIdFromToolContext(ctx) {
  const candidates = [
    ctx?.agentTo,
    ctx?.deliveryContext?.to,
    ctx?.deliveryContext?.conversationId,
    ctx?.sessionKey
  ].filter(Boolean);
  for (const candidate of candidates) {
    const raw = String(candidate).trim();
    const group = raw.match(/(\d+@g\.us)/i)?.[1];
    if (group) return group;
    if (raw) return raw;
  }
  return "unknown-chat";
}

function isAllowedWishlistGroup(chatId) {
  const allowedGroups = String(process.env.WISHLIST_ALLOWED_GROUPS ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedGroups.includes("*") || allowedGroups.includes(chatId);
}

function trustedWishlistChat(event, ctx) {
  if (event?.channel !== "whatsapp" && ctx?.channelId !== "whatsapp") return null;
  const chatId = whatsappGroupIdFrom(event, ctx);
  if (!chatId || !isAllowedWishlistGroup(chatId)) return null;
  return chatId;
}

function sourcePlatformFromToolContext(ctx, chatId) {
  const raw = String(ctx?.messageChannel ?? "").trim().toLowerCase();
  if (raw) return raw;
  return String(chatId).includes("@g.us") ? "whatsapp" : "openclaw";
}

function toolTextResult(text, details) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    details
  };
}

function wishlistToolInstruction() {
  return [
    "Wishlist/backlog/list memory must use the wishlist_update tool.",
    "Do not create ykc.md, action.md, wishlist.md, or other wishlist files in the workspace root.",
    "Use wishlist_update for show, add, done, undone, and import requests related to wishlist/backlog/list memory.",
    "The tool is the only allowed writer for openclaw-obsidian-vault/memory/wishlists/backlog-wishlist.md.",
    "When the user refers to a quoted WhatsApp bubble, use the quoted text below as source context.",
    "When the user asks to mark/change/edit an existing item, compare against the current Markdown below before calling the tool.",
    "After the tool returns, keep your final answer short and preserve any [md-bot] result text from the tool."
  ].join("\n");
}

function wishlistPromptContext(event) {
  const quotedText = quotedTextFrom(event);
  const wishlistContent = readWishlistContent();
  const blocks = [];

  if (quotedText) {
    blocks.push([
      "Quoted WhatsApp message, if the current user message refers to `this`, `that`, or a replied bubble:",
      "<quoted_whatsapp_message>",
      compactContextText(quotedText, 12000),
      "</quoted_whatsapp_message>"
    ].join("\n"));
  }

  blocks.push([
    "Current canonical wishlist Markdown. This is read-only context for you; write changes only through wishlist_update:",
    "<current_wishlist_markdown>",
    compactContextText(wishlistContent || "(empty)", 30000),
    "</current_wishlist_markdown>"
  ].join("\n"));

  return blocks.join("\n\n");
}

export default definePluginEntry({
  id: "task-gate",
  name: "Task Gate",
  description: "Suppresses default model replies for deterministic task commands.",
  register(api) {
    if (modeUsesTool()) {
      api.registerTool((ctx) => ({
        name: "wishlist_update",
        label: "Wishlist Update",
        description:
          "Update or read the user's Git-backed Markdown wishlist memory. Use for wishlist, backlog, list, YKC, JKT, ACTION, travel, food, activity, done, undone, show, save, import, or add requests. This tool writes only the configured wishlist Markdown file and commits only that file.",
        parameters: Type.Object({
          action: Type.String({
            description: "One of: show, add, done, undone, import."
          }),
          board: Type.String({
            description: "Wishlist board key, for example ykc, jkt, action, friendship, bali, bandung."
          }),
          section: Type.Optional(Type.String({
            description: "Target section/month/category, for example ACTIVITY, LOCAL FOOD, JUNE, APR."
          })),
          item: Type.Optional(Type.String({
            description: "Single item to add or mark done/pending."
          })),
          items: Type.Optional(Type.Array(Type.String({
            description: "Multiple items to add under the same board and section."
          }))),
          query: Type.Optional(Type.String({
            description: "Search text for done/undone."
          })),
          content: Type.Optional(Type.String({
            description: "Full pasted list content for import."
          })),
          quoted_text: Type.Optional(Type.String({
            description: "Quoted WhatsApp bubble text when the user replied to an existing list/message."
          }))
        }),
        async execute(_toolCallId, params) {
          const chatId = chatIdFromToolContext(ctx);
          const sourcePlatform = sourcePlatformFromToolContext(ctx, chatId);
          const result = await processWishlistToolAction({
            action: String(params.action ?? "").toLowerCase(),
            board: String(params.board ?? ""),
            section: typeof params.section === "string" ? params.section : undefined,
            item: typeof params.item === "string" ? params.item : undefined,
            items: Array.isArray(params.items) ? params.items.filter((item) => typeof item === "string") : undefined,
            query: typeof params.query === "string" ? params.query : undefined,
            content: typeof params.content === "string" ? params.content : undefined,
            quotedText: typeof params.quoted_text === "string" ? params.quoted_text : undefined,
            sourcePlatform,
            chatId
          });
          const text = result.messages.join("\n\n").trim() || "[md-bot] No wishlist change was made.";
          return toolTextResult(text, {
            status: text.includes("Git: commit failed") ? "failed" : "ok",
            chatId,
            sourcePlatform
          });
        }
      }), { name: "wishlist_update" });
    }

    api.on("before_dispatch", async (event, ctx) => {
      if (!modeUsesDeterministic()) return;
      if (event?.channel !== "whatsapp" && ctx?.channelId !== "whatsapp") return;

      const chatId = whatsappGroupIdFrom(event, ctx);
      if (!event?.isGroup && !chatId) return;
      const text = dispatchTextFrom(event);
      if (!chatId || !text || NO_REPLY_RE.test(text)) return;
      if (!looksPossiblyWishlistRequest(text)) return;
      const quotedText = quotedTextFrom(event);
      const wishlistContent = readWishlistContent();

      const result = await processWishlistAssistant({
        text,
        sourcePlatform: "whatsapp",
        chatId,
        quotedText,
        wishlistContent,
        deterministicOnly: wishlistMode() === "hybrid",
        quietUnrecognized: wishlistMode() === "hybrid"
      });
      const replyText = result.messages.join("\n\n").trim();
      if (!replyText || !MD_BOT_REPLY_RE.test(replyText)) return;

      api.logger.info("handled wishlist before dispatch", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        sessionKey: ctx.sessionKey
      });

      return {
        handled: true,
        text: replyText
      };
    });

    api.on("before_prompt_build", (event, ctx) => {
      const syntheticReply = syntheticTaskReply(event);
      if (syntheticReply) {
        api.logger.info("enforcing deterministic task reply prompt", {
          channelId: ctx.channelId,
          messageProvider: ctx.messageProvider,
          sessionKey: ctx.sessionKey
        });

        return {
          prependSystemContext: deterministicReplyInstruction(syntheticReply),
          prependContext: deterministicReplyInstruction(syntheticReply)
        };
      }

      if (modeUsesTool()) {
        if (!trustedWishlistChat(event, ctx)) return;
        const text = [
          textFrom(event?.body),
          textFrom(event?.bodyForAgent),
          textFrom(event?.content),
          textFrom(event?.context?.bodyForAgent),
          textFrom(event?.context?.content),
          textFrom(event?.context?.text)
        ].find(Boolean) ?? "";
        if (!looksPossiblyWishlistRequest(text)) return;

        api.logger.info("adding wishlist tool instruction", {
          channelId: ctx.channelId,
          messageProvider: ctx.messageProvider,
          sessionKey: ctx.sessionKey,
          hasQuotedText: Boolean(quotedTextFrom(event))
        });

        const instruction = `${wishlistToolInstruction()}\n\n${wishlistPromptContext(event)}`;
        return {
          prependSystemContext: instruction,
          prependContext: instruction
        };
      }
    });

    api.on("before_agent_reply", (event, ctx) => {
      const syntheticReply = syntheticTaskReply(event);
      if (syntheticReply) {
        api.logger.info("using deterministic task reply", {
          channelId: ctx.channelId,
          messageProvider: ctx.messageProvider,
          sessionKey: ctx.sessionKey
        });

        return {
          handled: true,
          reason: "deterministic_task_reply",
          reply: {
            text: syntheticReply
          }
        };
      }

      const reason = shouldSilence(event);
      if (!reason) return;

      api.logger.info("silencing default agent reply", {
        reason,
        channelId: ctx.channelId,
        messageProvider: ctx.messageProvider,
        sessionKey: ctx.sessionKey
      });

      return {
        handled: true,
        reason,
        reply: {
          text: "NO_REPLY"
        }
      };
    });
  }
});
