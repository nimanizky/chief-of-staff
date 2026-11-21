import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const receiptClassifications = [
  "food",
  "mobility",
  "groceries",
  "nonfood",
  "subscription",
  "income"
] as const;

export type ReceiptClassification = (typeof receiptClassifications)[number];

export type ClassificationSource =
  | "mistral"
  | "personal_override"
  | "fallback";

export type ClassificationDecision = {
  modelClassification: ReceiptClassification | string;
  finalClassification: ReceiptClassification;
  classificationSource: ClassificationSource;
  matchedOverride?: string;
};

type OverrideConfig = Partial<Record<ReceiptClassification, string[]>>;

const DEFAULT_MODEL_CLASSIFICATION: ReceiptClassification = "nonfood";
const CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../config/receipt-classification-overrides.json"
);

export function isReceiptClassification(value: unknown): value is ReceiptClassification {
  return typeof value === "string" && receiptClassifications.includes(value as ReceiptClassification);
}

function loadOverrideConfig(): OverrideConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};

    const config: OverrideConfig = {};
    for (const classification of receiptClassifications) {
      const keywords = (raw as Record<string, unknown>)[classification];
      if (!Array.isArray(keywords)) continue;

      config[classification] = keywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0);
    }

    return config;
  } catch {
    return {};
  }
}

function findPersonalOverride(merchantName: string, rawText: string): {
  classification: ReceiptClassification;
  keyword: string;
} | null {
  const normalized = `${merchantName} ${rawText}`.toLowerCase();
  const config = loadOverrideConfig();

  for (const classification of receiptClassifications) {
    const keywords = config[classification] ?? [];
    const keyword = keywords.find((candidate) => normalized.includes(candidate));
    if (keyword) {
      return {
        classification,
        keyword
      };
    }
  }

  return null;
}

export function applyPersonalClassificationOverride(
  modelClassification: unknown,
  merchantName: string,
  rawText: string
): ClassificationDecision {
  const validModelClassification = isReceiptClassification(modelClassification)
    ? modelClassification
    : DEFAULT_MODEL_CLASSIFICATION;
  const fallbackUsed = !isReceiptClassification(modelClassification);
  const override = findPersonalOverride(merchantName, rawText);

  if (override) {
    return {
      modelClassification: typeof modelClassification === "string" ? modelClassification : "missing",
      finalClassification: override.classification,
      classificationSource: "personal_override",
      matchedOverride: override.keyword
    };
  }

  return {
    modelClassification: typeof modelClassification === "string" ? modelClassification : "missing",
    finalClassification: validModelClassification,
    classificationSource: fallbackUsed ? "fallback" : "mistral"
  };
}
