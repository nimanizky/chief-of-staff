import { env } from "../../config/env.js";
import { getReceiptModelConfig } from "../../config/providers.js";

const WHITESPACE_SEQUENCE_PATTERN = /\s+/g;

export type ReceiptModelHealthResult =
  | {
      ok: true;
      provider: string;
      model: string;
      servedModel: string;
      latencyMs: number;
      sample: string;
    }
  | {
      ok: false;
      provider: string;
      model: string;
      latencyMs: number;
      status?: number;
      error: string;
      details?: string;
    };

export type ModelHealthLogger = {
  request(input: { endpoint: string; model: string }): void;
  response(input: { status: number; ok: boolean; latencyMs: number; bodyPreview: string }): void;
  invalidJson(input: { bodyPreview: string }): void;
  parseOk(input: {
    configuredModel: string;
    servedModel: string;
    rawContentType: string;
    samplePreview: string;
    latencyMs: number;
  }): void;
  requestError(input: { error: string }): void;
};

type TextHealthRequest = {
  provider: "mistral" | "google";
  model: string;
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
};

function safeErrorDetails(details: string): string {
  const trimmed = details.trim();
  if (!trimmed) return "";
  return trimmed.replace(WHITESPACE_SEQUENCE_PATTERN, " ").slice(0, 220);
}

function extractMistralContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: string }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

function preview(value: string, max = 360): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function buildHealthRequest(provider: "mistral" | "google", model: string): TextHealthRequest {
  if (provider === "google") {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required for Google model health checks.");
    }

    return {
      provider,
      model,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: "Reply with exactly: OK" }]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16
        }
      }
    };
  }

  if (!env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is required for Mistral model health checks.");
  }

  return {
    provider,
    model,
    endpoint: `${env.MISTRAL_API_BASE}/v1/chat/completions`,
    headers: {
      Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: {
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: OK"
        }
      ]
    }
  };
}

function extractHealthContent(provider: "mistral" | "google", payload: unknown): { servedModel: string; sample: string } {
  if (provider === "google") {
    const geminiPayload = payload as {
      modelVersion?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const sample =
      geminiPayload.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim()
        .slice(0, 120) || "(empty)";

    return {
      servedModel: String(geminiPayload.modelVersion ?? "unknown"),
      sample
    };
  }

  const mistralPayload = payload as {
    model?: string;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const rawContent = mistralPayload.choices?.[0]?.message?.content;
  return {
    servedModel: String(mistralPayload.model ?? "unknown"),
    sample: extractMistralContent(rawContent).slice(0, 120) || "(empty)"
  };
}

export async function checkReceiptModelHealth(logger?: ModelHealthLogger): Promise<ReceiptModelHealthResult> {
  const startedAt = Date.now();
  const modelConfig = getReceiptModelConfig();
  const { provider, model, endpoint, headers, body } = buildHealthRequest(modelConfig.provider, modelConfig.model);

  logger?.request({ endpoint, model });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();

    logger?.response({
      status: response.status,
      ok: response.ok,
      latencyMs,
      bodyPreview: preview(bodyText)
    });

    if (!response.ok) {
      return {
        ok: false,
        provider,
        model,
        latencyMs,
        status: response.status,
        error: `HTTP ${response.status}`,
        details: safeErrorDetails(bodyText)
      };
    }

    let payload: unknown = {};

    try {
      payload = JSON.parse(bodyText);
    } catch {
      logger?.invalidJson({ bodyPreview: preview(bodyText) });
      return {
        ok: false,
        provider,
        model,
        latencyMs,
        error: `Invalid JSON response from ${provider} API.`
      };
    }

    const { sample, servedModel } = extractHealthContent(provider, payload);

    logger?.parseOk({
      configuredModel: model,
      servedModel,
      rawContentType: typeof payload,
      samplePreview: preview(sample),
      latencyMs
    });

    return {
      ok: true,
      provider,
      model,
      servedModel,
      latencyMs,
      sample
    };
  } catch (error) {
    logger?.requestError({
      error: (error as Error)?.message ?? "Unknown network error"
    });
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      error: (error as Error)?.message ?? "Unknown network error"
    };
  }
}

export function formatReceiptModelHealthMessage(result: ReceiptModelHealthResult): string {
  if (result.ok === true) {
    return `Model connectivity: OK
Provider: ${result.provider}
Configured model: ${result.model}
Served model: ${result.servedModel}
Latency: ${result.latencyMs}ms
Sample: ${result.sample}`;
  }

  const statusLine = result.status ? `Status: ${result.status}\n` : "";
  const detailsLine = result.details ? `Details: ${result.details}\n` : "";
  return `Model connectivity: FAILED
Provider: ${result.provider}
Configured model: ${result.model}
${statusLine}${detailsLine}Error: ${result.error}
Latency: ${result.latencyMs}ms`;
}
