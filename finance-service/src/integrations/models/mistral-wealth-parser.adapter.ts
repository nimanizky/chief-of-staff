import { env } from "../../config/env.js";
import { wealthAssetTypes, wealthPlatforms } from "../../domains/wealth/wealth.schema.js";
import type { WealthParseCandidate } from "../../domains/wealth/wealth-parser.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";

type MistralMessageContentPart = {
  type?: string;
  text?: string;
};

type MistralChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | MistralMessageContentPart[];
    };
  }>;
};

const MODEL_MAX_ATTEMPTS = 3;
const MODEL_BASE_BACKOFF_MS = 750;
const MISTRAL_CHAT_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions";

export const WEALTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    platform: {
      type: "string",
      enum: wealthPlatforms
    },
    account_name: { type: "string" },
    asset_type: {
      type: "string",
      enum: wealthAssetTypes
    },
    amount: { type: "number" },
    snapshot_date: { type: "string" },
    raw_text: { type: "string" },
    confidence: { type: "number" }
  },
  required: ["platform", "account_name", "asset_type", "amount", "snapshot_date", "raw_text", "confidence"]
} as const;

const parserInstructions = `
You are a wealth statement parser.
Extract only from visible printed values in bank, brokerage, mutual fund, gold, or crypto reports.
Output strict JSON with keys:
platform, account_name, asset_type, amount, snapshot_date, raw_text, confidence.
Rules:
- platform must be exactly one of: jago, bca, jenius, stockbit, bibit, pluang, other
- asset_type must be exactly one of: cash, stocks, mutual_fund, crypto, gold, deposit, other
- amount is the total account/portfolio balance in IDR, numeric only
- snapshot_date format: YYYY-MM-DD; if no statement date is visible, use an empty string
- For Stockbit, prefer total portfolio value or total asset value.
- For Bibit, prefer total portfolio/investment value.
- For Pluang, prefer total portfolio value; use gold/crypto only if visible and specific.
- For banks, prefer saldo akhir, total saldo, available balance, or equivalent.
- confidence between 0 and 1
- raw_text should include a short excerpt of the evidence used.
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNetworkCode(error: unknown): string {
  return String(
    (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code ??
      ""
  );
}

function isRetryableModelError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;

  const code = getNetworkCode(error);
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

function contentToString(content: string | MistralMessageContentPart[] | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function callMistralParse(
  imageBase64: string,
  mimeType: string,
  captionText: string | undefined,
  model: string
): Promise<string> {
  if (!env.MISTRAL_API_KEY) {
    throw new ReceiptError("MODEL_PERMANENT", "MISTRAL_API_KEY is required for the Mistral wealth parser.");
  }

  const response = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wealth_parse_candidate",
          schema: WEALTH_SCHEMA,
          strict: true
        }
      },
      messages: [
        {
          role: "system",
          content: parserInstructions
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Parse this wealth statement snapshot.${captionText ? ` Caption: ${captionText}` : ""}`
            },
            {
              type: "image_url",
              image_url: `data:${mimeType};base64,${imageBase64}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ReceiptError("MODEL_PERMANENT", "Mistral wealth request failed.", {
      status: response.status,
      metadata: {
        body: bodyText.slice(0, 800)
      }
    });
  }

  const payload = (await response.json()) as MistralChatResponse;
  const outputText = contentToString(payload.choices?.[0]?.message?.content);
  if (!outputText) {
    throw new ReceiptError("MODEL_PERMANENT", "Mistral returned empty wealth output.");
  }

  return outputText;
}

async function callModelWithRetries(
  imageBase64: string,
  mimeType: string,
  captionText: string | undefined,
  model: string
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callMistralParse(imageBase64, mimeType, captionText, model);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableModelError(error);
      if (!retryable || attempt === MODEL_MAX_ATTEMPTS) break;

      const backoffMs = MODEL_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoffMs);
    }
  }

  const retryable = isRetryableModelError(lastError);
  const status = getErrorStatus(lastError);
  if (retryable) {
    throw new ReceiptError("MODEL_TEMPORARY", "Temporary wealth model provider error.", {
      cause: lastError,
      status,
      metadata: { attempts: MODEL_MAX_ATTEMPTS }
    });
  }

  throw new ReceiptError("MODEL_PERMANENT", "Model provider rejected the wealth parsing request.", {
    cause: lastError,
    status
  });
}

export async function extractWealthSnapshotFromImage(
  imageBase64: string,
  mimeType: string,
  captionText?: string,
  model = "mistral-small-latest"
): Promise<WealthParseCandidate> {
  const outputText = await callModelWithRetries(imageBase64, mimeType, captionText, model);

  try {
    return JSON.parse(outputText) as WealthParseCandidate;
  } catch (error) {
    throw new ReceiptError("MODEL_PERMANENT", "Wealth model output could not be parsed as JSON.", {
      cause: error
    });
  }
}
