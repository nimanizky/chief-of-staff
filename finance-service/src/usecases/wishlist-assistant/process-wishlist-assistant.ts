import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "../../config/env.js";
import { commitMemoryVaultFile, type MemoryVaultGitResult } from "../../integrations/memory/git-memory-vault.js";
import { classifyWishlistCommandWithModel } from "./classify-wishlist-command.js";
import { applyWishlistCommand, parseWishlistCommand } from "./wishlist-markdown.js";

export type WishlistAssistantInput = {
  text: string;
  sourcePlatform: string;
  chatId: string;
};

export type WishlistAssistantResult = {
  messages: string[];
};

export async function processWishlistAssistant(input: WishlistAssistantInput): Promise<WishlistAssistantResult> {
  if (!isAllowedWishlistGroup(input.sourcePlatform, input.chatId)) {
    return {
      messages: [
        mdBotReply(
          `Wishlist is not enabled for this chat (${input.sourcePlatform}:${input.chatId}). Add it to WISHLIST_ALLOWED_GROUPS.`
        )
      ]
    };
  }

  let command = parseWishlistCommand(input.text);
  if (!command && shouldAskModelToClassify(input.text)) {
    try {
      command = await classifyWishlistCommandWithModel(input.text);
    } catch (error) {
      return {
        messages: [mdBotReply(`Wishlist command not recognized. Model classifier failed (${formatErrorMessage(error)}).`)]
      };
    }
  }

  if (!command) {
    if (looksLikeInvisibleReference(input.text)) {
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

  const wishlistPath = resolveWishlistFilePath();
  if (!wishlistPath) {
    return {
      messages: [
        mdBotReply("Wishlist storage is not configured. Set OPENCLAW_MEMORY_VAULT_PATH or WISHLIST_FILE_PATH.")
      ]
    };
  }

  const current = await readTextIfExists(wishlistPath);
  const result = applyWishlistCommand(current, command);

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
