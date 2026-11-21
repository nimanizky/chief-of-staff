import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { processWishlistAssistant } from "../../dist/usecases/wishlist-assistant/process-wishlist-assistant.js";

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

function isGeneralWhatsApp(event, ctx) {
  return envBool("OPENCLAW_GENERAL_WHATSAPP", false) &&
    [event?.channel, ctx?.channelId, ctx?.messageProvider].some(
      (value) => String(value ?? "").toLowerCase() === "whatsapp"
    );
}

export default definePluginEntry({
  id: "task-gate",
  name: "Task Gate",
  description: "Suppresses default model replies for deterministic task commands.",
  register(api) {
    api.on("before_dispatch", async (event, ctx) => {
      if (isGeneralWhatsApp(event, ctx)) return;
      if (!envBool("WISHLIST_EXACT_DISPATCH", true)) return;
      if (event?.channel !== "whatsapp" && ctx?.channelId !== "whatsapp") return;

      const chatId = whatsappGroupIdFrom(event, ctx);
      if (!event?.isGroup && !chatId) return;
      const text = dispatchTextFrom(event);
      if (!chatId || !text || NO_REPLY_RE.test(text)) return;
      if (!looksPossiblyWishlistRequest(text)) return;

      const result = await processWishlistAssistant({
        text,
        sourcePlatform: "whatsapp",
        chatId
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
      if (isGeneralWhatsApp(event, ctx)) return;
      const syntheticReply = syntheticTaskReply(event);
      if (!syntheticReply) return;

      api.logger.info("enforcing deterministic task reply prompt", {
        channelId: ctx.channelId,
        messageProvider: ctx.messageProvider,
        sessionKey: ctx.sessionKey
      });

      return {
        prependSystemContext: deterministicReplyInstruction(syntheticReply),
        prependContext: deterministicReplyInstruction(syntheticReply)
      };
    });

    api.on("before_agent_reply", (event, ctx) => {
      if (isGeneralWhatsApp(event, ctx)) return;
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
