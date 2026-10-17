import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "../../config/env.js";
import { commitMemoryVaultFile, type MemoryVaultGitResult } from "../../integrations/memory/git-memory-vault.js";
import { classifyWishlistCommandWithModel } from "./classify-wishlist-command.js";
import { applyWishlistCommand, parseWishlistCommand, type WishlistCommand } from "./wishlist-markdown.js";

export type WishlistAssistantInput = {
  text: string;
  sourcePlatform: string;
  chatId: string;
  quotedText?: string;
  wishlistContent?: string;
  deterministicOnly?: boolean;
  quietUnrecognized?: boolean;
};

export type WishlistAssistantResult = {
  messages: string[];
};

export type WishlistToolActionInput = {
  action: "show" | "add" | "done" | "undone" | "import";
  board: string;
  section?: string;
  item?: string;
  items?: string[];
  query?: string;
  content?: string;
  quotedText?: string;
  sourcePlatform: string;
  chatId: string;
};

export async function processWishlistAssistant(input: WishlistAssistantInput): Promise<WishlistAssistantResult> {
  const allowed = validateWishlistAccess(input.sourcePlatform, input.chatId);
  if (allowed) return allowed;

  let command = parseWishlistCommand(input.text);
  if (!command && !input.deterministicOnly && shouldAskModelToClassify(input.text)) {
    try {
      command = await classifyWishlistCommandWithModel(formatClassifierInput(input));
    } catch (error) {
      return {
        messages: [mdBotReply(`Wishlist command not recognized. Model classifier failed (${formatErrorMessage(error)}).`)]
      };
    }
  }

  if (!command) {
    if (input.quietUnrecognized) return { messages: [] };
    if (looksLikeInvisibleReference(input.text) && !input.quotedText) {
      return {
        messages: [
          mdBotReply(
            "I can save pasted text, but I cannot read the WhatsApp quoted bubble in this controlled path yet. Paste the list in the same message, then say `add this into action list`."
          )
        ]
      };
    }
    return { messages: [mdBotReply("Wishlist command not recognized. Use show, add, done, or undone.")] };
  }

  return processWishlistCommand({
    command,
    sourcePlatform: input.sourcePlatform,
    chatId: input.chatId
  });
}

export async function processWishlistToolAction(input: WishlistToolActionInput): Promise<WishlistAssistantResult> {
  const allowed = validateWishlistAccess(input.sourcePlatform, input.chatId);
  if (allowed) return allowed;

  const command = wishlistCommandFromToolAction(input);
  if (!command) {
    return {
      messages: [mdBotReply("Wishlist tool input was invalid. Provide action, board, and the required item/query/content.")]
    };
  }

  return processWishlistCommand({
    command,
    sourcePlatform: input.sourcePlatform,
    chatId: input.chatId
  });
}

async function processWishlistCommand(input: {
  command: WishlistCommand;
  sourcePlatform: string;
  chatId: string;
}): Promise<WishlistAssistantResult> {
  const wishlistPath = resolveWishlistFilePath();
  if (!wishlistPath) {
    return {
      messages: [
        mdBotReply("Wishlist storage is not configured. Set OPENCLAW_MEMORY_VAULT_PATH or WISHLIST_FILE_PATH.")
      ]
    };
  }

  const current = await readTextIfExists(wishlistPath);
  const result = applyWishlistCommand(current, input.command);

  if (result.status !== "changed") {
    return { messages: [mdBotReply(result.message)] };
  }

  await mkdir(dirname(wishlistPath), { recursive: true });
  await writeFile(wishlistPath, result.content, "utf8");

  let gitResult: MemoryVaultGitResult;
  try {
    gitResult = await commitMemoryVaultFile(wishlistPath, result.commitMessage);
  } catch (error) {
    return {
      messages: [mdBotReply(`${result.message}\nGit: commit failed (${formatErrorMessage(error)}).`)]
    };
  }

  return {
    messages: [mdBotReply(formatSavedMessage(result.message, gitResult))]
  };
}

function validateWishlistAccess(sourcePlatform: string, chatId: string): WishlistAssistantResult | null {
  if (isAllowedWishlistGroup(sourcePlatform, chatId)) return null;
  return {
    messages: [
      mdBotReply(
        `Wishlist is not enabled for this chat (${sourcePlatform}:${chatId}). Add it to WISHLIST_ALLOWED_GROUPS.`
      )
    ]
  };
}

function shouldAskModelToClassify(text: string): boolean {
  return /\b(?:wishlist|wish|backlog|list|show|add|save|store|put|import|done|undone|mark|ykc|jkt|action)\b/i.test(text);
}

function looksLikeInvisibleReference(text: string): boolean {
  return /\b(?:add|save|store|put|import)\b/i.test(text) && /\b(?:this|these|that|all)\b/i.test(text);
}

function isAllowedWishlistGroup(sourcePlatform: string, chatId: string): boolean {
  if (sourcePlatform !== "whatsapp") return false;
  const allowedGroups = env.WISHLIST_ALLOWED_GROUPS.split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedGroups.includes("*") || allowedGroups.includes(chatId);
}

function wishlistCommandFromToolAction(input: WishlistToolActionInput): WishlistCommand | null {
  const board = normalizeBoard(input.board);
  if (!board) return null;

  switch (input.action) {
    case "show": {
      const section = normalizeOptional(input.section);
      return section ? { kind: "show", board, section } : { kind: "show", board };
    }
    case "add": {
      const section = normalizeOptional(input.section);
      const items = normalizeItems(input.items);
      const item = normalizeOptional(input.item) ?? items[0];
      if (!section || !item) return null;
      if (items.length > 1) {
        return {
          kind: "import",
          board,
          content: `${board.toUpperCase()} WISHLIST\n\n${section}\n${items.join("\n")}`
        };
      }
      return { kind: "add", board, section, item };
    }
    case "done":
    case "undone": {
      const query = normalizeOptional(input.query) ?? normalizeOptional(input.item);
      if (!query) return null;
      return { kind: input.action, board, query };
    }
    case "import": {
      const content = normalizeOptional(input.content) ?? normalizeOptional(input.quotedText);
      if (!content) return null;
      return { kind: "import", board, content };
    }
  }
}

function formatClassifierInput(input: WishlistAssistantInput): string {
  const parts = [`USER_MESSAGE:\n${input.text.trim()}`];
  if (input.quotedText?.trim()) {
    parts.push(`QUOTED_WHATSAPP_MESSAGE:\n${input.quotedText.trim()}`);
  }
  if (input.wishlistContent?.trim()) {
    parts.push(`CURRENT_WISHLIST_MARKDOWN:\n${input.wishlistContent.trim()}`);
  }
  return parts.join("\n\n---\n\n");
}

function normalizeBoard(value: string): string {
  return value
    .replace(/\b(?:wishlist|backlog|list)\b/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/gi, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function normalizeItems(values: string[] | undefined): string[] {
  return (values ?? []).map(normalizeOptional).filter((value): value is string => Boolean(value));
}

function resolveWishlistFilePath(): string | null {
  if (env.WISHLIST_FILE_PATH) return env.WISHLIST_FILE_PATH;
  if (!env.OPENCLAW_MEMORY_VAULT_PATH) return null;
  return join(env.OPENCLAW_MEMORY_VAULT_PATH, "memory", "wishlists", "backlog-wishlist.md");
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return "";
    throw error;
  }
}

function formatSavedMessage(message: string, gitResult: MemoryVaultGitResult): string {
  if (gitResult.status === "committed") {
    return `${message}\nGit: committed${gitResult.pushed ? " and pushed" : ""}.`;
  }

  const reason =
    gitResult.reason === "disabled"
      ? "auto-commit disabled"
      : gitResult.reason === "missing_vault_path"
        ? "vault path missing"
        : gitResult.reason === "outside_vault"
          ? "file outside vault"
          : "no changes";
  return `${message}\nGit: skipped (${reason}).`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}

function mdBotReply(message: string): string {
  return `[md-bot] ${message}`;
}
