import type { WishlistCommand } from "./wishlist-markdown.js";

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type WishlistModelAction = {
  action?: "show" | "add" | "done" | "undone" | "import" | "noop";
  board?: string;
  section?: string;
  item?: string;
  query?: string;
  content?: string;
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const WISHLIST_CLASSIFIER_INSTRUCTIONS = `
You classify WhatsApp messages for a Markdown wishlist assistant.
Return only strict JSON.

Supported JSON shape:
{
  "action": "show" | "add" | "done" | "undone" | "import" | "noop",
  "board": "short-board-key",
  "section": "section name when needed",
  "item": "single item to add when action is add",
  "query": "item search text when action is done or undone",
  "content": "pasted wishlist block when action is import"
}

Rules:
- Use action "noop" when the message is not asking to save, show, add, mark done, mark pending, or import a wishlist/backlog.
- A board is a flexible key such as ykc, jkt, action, friendship, bali, bandung.
- For "show action", board is "action".
- For "save all of this as ykc", action is "import", board is "ykc".
- For "put this into action list", action is "import", board is "action".
- For "add ykc activity gudeg", action is "add", board "ykc", section "activity", item "gudeg".
- For pasted lists, copy the user's pasted list into content. Do not invent items.
- Do not write Markdown, do not explain, do not include prose.
`.trim();

export async function classifyWishlistCommandWithModel(rawText: string): Promise<WishlistCommand | null> {
  const { env } = await import("../../config/env.js");
  if (!env.WISHLIST_MODEL_CLASSIFIER || !env.GEMINI_API_KEY) return null;

  const action = await callGeminiWishlistClassifier(rawText, env.GEMINI_API_KEY, env.WISHLIST_MODEL_NAME);
  return coerceWishlistModelAction(action, rawText);
}

export function coerceWishlistModelAction(action: WishlistModelAction, rawText: string): WishlistCommand | null {
  const kind = action.action;
  if (!kind || kind === "noop") return null;

  const board = normalizeBoardKey(action.board ?? "");
  if (!board) return null;

  if (kind === "show") {
    const section = normalizeSection(action.section ?? "");
    return section ? { kind: "show", board, section } : { kind: "show", board };
  }

  if (kind === "add") {
    const section = normalizeSection(action.section ?? "");
    const item = normalizeText(action.item ?? "");
    if (!section || !item) return null;
    return { kind: "add", board, section, item };
  }

  if (kind === "done" || kind === "undone") {
    const query = normalizeText(action.query ?? action.item ?? "");
    if (!query) return null;
    return { kind, board, query };
  }

  if (kind === "import") {
    const content = extractImportContent(rawText, board, action.content);
    if (!content) return null;
    return { kind: "import", board, content };
  }

  return null;
}

async function callGeminiWishlistClassifier(rawText: string, apiKey: string, model: string): Promise<WishlistModelAction> {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: WISHLIST_CLASSIFIER_INSTRUCTIONS }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: rawText }]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Wishlist classifier request failed (${response.status}): ${bodyText.slice(0, 240)}`);
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  const output = payload.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (!output) return { action: "noop" };

  return JSON.parse(output) as WishlistModelAction;
}

function extractImportContent(rawText: string, board: string, modelContent?: string): string {
  const rawCandidate = stripCommandLines(rawText, board);
  if (looksLikeImportBlock(rawCandidate)) return rawCandidate;

  const modelCandidate = normalizeBlock(modelContent ?? "");
  if (looksLikeImportBlock(modelCandidate)) return modelCandidate;

  return rawCandidate;
}

function stripCommandLines(rawText: string, board: string): string {
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const kept = lines.filter((line) => {
    const cleaned = stripLeadingMention(line).trim();
    if (!cleaned) return true;
    if (/^(?:save|put|add|store|ingest|import)\b.*\b(?:this|these|all)\b/i.test(cleaned)) return false;
    if (new RegExp(`\\bas\\s+${escapeRegExp(board)}\\b`, "i").test(cleaned)) return false;
    if (new RegExp(`\\binto\\s+${escapeRegExp(board)}(?:\\s+list)?\\b`, "i").test(cleaned)) return false;
    return true;
  });

  return normalizeBlock(kept.join("\n"));
}

function looksLikeImportBlock(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  return lines.some((line) => /\b(?:WISHLIST|BACKLOG|LIST)\b/i.test(line));
}

function normalizeBoardKey(value: string): string {
  return normalizeText(value)
    .replace(/^!+\s*/, "")
    .replace(/\s*!+$/, "")
    .replace(/^#+\s*/, "")
    .replace(/\b(?:wishlist|backlog|list)\b/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/gi, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeSection(value: string): string {
  return normalizeText(value).replace(/[:：]\s*$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripLeadingMention(line).trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function stripLeadingMention(value: string): string {
  return value.replace(/^\s*@\S+(?:\s+|$)/u, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
