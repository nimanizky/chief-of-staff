import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectTaskTrigger, shouldGateDefaultAgentReply } from "../../dist/task-router/task-trigger.detector.js";
import type { TaskRouterContext } from "./types.ts";

type ModuleId =
  | "general-chat"
  | "receipt-parser"
  | "receipt-parser-v2"
  | "model-health"
  | "finance-digest"
  | "calory-assistant"
  | "cicilan-assistant"
  | "wealth-assistant"
  | "budget-assistant"
  | "wishlist-assistant";

type ChannelPolicy = {
  name?: string;
  modules?: ModuleId[];
  media?: ModuleId;
  unknownText?: "general-chat" | "ignore";
};

type ChannelRoutingConfig = {
  defaultPolicy?: ChannelPolicy;
  chats?: Record<string, ChannelPolicy>;
  modules?: Record<string, { type?: string; version?: string }>;
};

export type ResolvedChannelPolicy = {
  key: string;
  name: string;
  modules: ModuleId[];
  media: ModuleId;
  unknownText: "general-chat" | "ignore";
};

const DEFAULT_POLICY: ResolvedChannelPolicy = {
  key: "default",
  name: "default",
  modules: ["receipt-parser"],
  media: "receipt-parser",
  unknownText: "ignore"
};

function loadRoutingConfig(): ChannelRoutingConfig {
  const configPath = resolve(process.cwd(), "config/channel-routing.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as ChannelRoutingConfig;
}

function normalizePolicy(key: string, policy?: ChannelPolicy): ResolvedChannelPolicy {
  return {
    key,
    name: policy?.name ?? key,
    modules: policy?.modules?.length ? policy.modules : DEFAULT_POLICY.modules,
    media: policy?.media ?? DEFAULT_POLICY.media,
    unknownText: policy?.unknownText ?? DEFAULT_POLICY.unknownText
  };
}

function chatKeys(context: TaskRouterContext): string[] {
  const keys = new Set<string>();
  const source = context.sourcePlatform || "openclaw";

  if (context.chatId) {
    keys.add(context.chatId);
    keys.add(`${source}:${context.chatId}`);
  }

  if (context.telegramChatId) {
    keys.add(context.telegramChatId);
    keys.add(`telegram:${context.telegramChatId}`);
  }

  return [...keys];
}

export function resolveChannelPolicy(context: TaskRouterContext): ResolvedChannelPolicy {
  try {
    const config = loadRoutingConfig();
    for (const key of chatKeys(context)) {
      const chatPolicy = config.chats?.[key];
      if (chatPolicy) {
        return normalizePolicy(key, {
          ...config.defaultPolicy,
          ...chatPolicy
        });
      }
    }
    return normalizePolicy("default", config.defaultPolicy);
  } catch {
    return DEFAULT_POLICY;
  }
}

export function shouldLetDefaultAgentHandle(context: TaskRouterContext, policy: ResolvedChannelPolicy): boolean {
  if (!policy.modules.includes("general-chat")) return false;

  const trigger = detectTaskTrigger(context.text, mediaKind(context));
  if (trigger.kind === "receipt-assistant" && trigger.source === "media_default") {
    return policy.media === "general-chat";
  }

  return trigger.kind === "unhandled" && policy.unknownText === "general-chat";
}

export function shouldRunTaskModule(context: TaskRouterContext, policy: ResolvedChannelPolicy): boolean {
  const trigger = detectTaskTrigger(context.text, mediaKind(context));

  if (trigger.kind === "receipt-assistant" || trigger.kind === "receipt-confirmation") {
    return policy.modules.includes("receipt-parser") || policy.modules.includes("receipt-parser-v2");
  }

  if (trigger.kind === "missing-media" && trigger.task === "receipt-assistant") {
    return policy.modules.includes("receipt-parser") || policy.modules.includes("receipt-parser-v2");
  }

  if (trigger.kind === "ambiguous") {
    return (
      policy.modules.includes("receipt-parser") ||
      policy.modules.includes("receipt-parser-v2") ||
      policy.modules.includes("calory-assistant")
    );
  }

  if (trigger.kind === "model-health") return policy.modules.includes("model-health");
  if (trigger.kind === "finance-digest") return policy.modules.includes("finance-digest");
  if (trigger.kind === "budget-assistant") return policy.modules.includes("budget-assistant");
  if (trigger.kind === "cicilan-assistant" || trigger.kind === "cicilan-confirmation") {
    return policy.modules.includes("cicilan-assistant");
  }
  if (trigger.kind === "wealth-assistant" || trigger.kind === "wealth-confirmation") {
    return policy.modules.includes("wealth-assistant");
  }
  if (trigger.kind === "wishlist-assistant") {
    if (context.sourcePlatform === "whatsapp") return false;
    return policy.modules.includes("wishlist-assistant");
  }
  if (trigger.kind === "calory-assistant") return policy.modules.includes("calory-assistant");
  if (trigger.kind === "missing-media" && trigger.task === "calory-assistant") {
    return policy.modules.includes("calory-assistant");
  }

  return false;
}

export function shouldSuppressDefaultAgent(context: TaskRouterContext, policy: ResolvedChannelPolicy): boolean {
  if (shouldLetDefaultAgentHandle(context, policy)) return false;
  const trigger = detectTaskTrigger(context.text, mediaKind(context));
  if (trigger.kind === "wishlist-assistant" && context.sourcePlatform === "whatsapp") {
    return false;
  }
  return shouldGateDefaultAgentReply(context.text, mediaKind(context)) || !policy.modules.includes("general-chat");
}

function mediaKind(context: TaskRouterContext) {
  const mimeTypes = context.mediaCandidates.map((media) => {
    const raw = String(media.mimeType ?? "").split(";")[0].trim().toLowerCase();
    if (raw) return raw;
    const lowerUrl = media.url.toLowerCase();
    if (lowerUrl.endsWith(".pdf")) return "application/pdf";
    if (lowerUrl.endsWith(".png")) return "image/png";
    if (lowerUrl.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  });

  return {
    hasMedia: context.mediaCandidates.length > 0,
    hasImage: mimeTypes.some((mime) => mime.startsWith("image/")),
    hasPdf: mimeTypes.some((mime) => mime === "application/pdf")
  };
}
