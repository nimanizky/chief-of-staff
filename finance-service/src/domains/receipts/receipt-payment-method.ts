import { env } from "../../config/env.js";

export type PaymentMethodSource = "caption" | "ocr" | "button" | "ambiguous" | "none";

export type PaymentMethodResolution = {
  paymentMethod: string;
  source: PaymentMethodSource;
  matchedAlias?: string;
};

type PaymentMethodConfig = {
  methods: string[];
  aliases: Map<string, string[]>;
  ambiguousAliases: string[];
};

const METHOD_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function splitList(value: string, delimiter: string): string[] {
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMethods(): string[] {
  const methods = splitList(env.RECEIPT_PAYMENT_METHODS, ",");
  if (methods.length === 0) {
    throw new Error("RECEIPT_PAYMENT_METHODS must contain at least one payment method.");
  }

  for (const method of methods) {
    if (!METHOD_PATTERN.test(method)) {
      throw new Error(`Invalid receipt payment method: ${method}`);
    }
  }

  return [...new Set(methods)];
}

function parseAliases(methods: string[]): Map<string, string[]> {
  const methodSet = new Set(methods);
  const aliases = new Map<string, string[]>();

  for (const entry of splitList(env.RECEIPT_PAYMENT_METHOD_ALIASES, ";")) {
    const [method, rawAliases] = entry.split("=");
    const normalizedMethod = method?.trim();
    if (!normalizedMethod || !rawAliases) continue;
    if (!methodSet.has(normalizedMethod)) {
      throw new Error(`Receipt payment alias references unknown method: ${normalizedMethod}`);
    }

    aliases.set(normalizedMethod, splitList(rawAliases, "|"));
  }

  return aliases;
}

function getPaymentMethodConfig(): PaymentMethodConfig {
  const methods = parseMethods();
  return {
    methods,
    aliases: parseAliases(methods),
    ambiguousAliases: splitList(env.RECEIPT_PAYMENT_AMBIGUOUS_ALIASES, "|")
  };
}

function findAliasMatch(text: string, aliases: Iterable<[string, string[]]>): PaymentMethodResolution | null {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) return null;

  for (const [method, methodAliases] of aliases) {
    for (const alias of methodAliases) {
      const normalizedAlias = normalizeForMatch(alias);
      if (!normalizedAlias) continue;
      if (normalizedText.includes(normalizedAlias)) {
        return {
          paymentMethod: method,
          source: "none",
          matchedAlias: alias
        };
      }
    }
  }

  return null;
}

function findAmbiguousMatch(text: string, aliases: string[]): PaymentMethodResolution | null {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) return null;

  for (const alias of aliases) {
    const normalizedAlias = normalizeForMatch(alias);
    if (!normalizedAlias) continue;
    if (normalizedText.includes(normalizedAlias)) {
      return {
        paymentMethod: "",
        source: "ambiguous",
        matchedAlias: alias
      };
    }
  }

  return null;
}

function withSource(
  resolution: PaymentMethodResolution | null,
  source: PaymentMethodSource
): PaymentMethodResolution | null {
  return resolution ? { ...resolution, source } : null;
}

export function getReceiptPaymentMethods(): string[] {
  return getPaymentMethodConfig().methods;
}

export function isReceiptPaymentMethod(value: string): boolean {
  return getPaymentMethodConfig().methods.includes(value);
}

export function resolveReceiptPaymentMethod(input: {
  captionText?: string;
  ocrText?: string;
}): PaymentMethodResolution {
  const config = getPaymentMethodConfig();
  const captionText = input.captionText ?? "";
  const ocrText = input.ocrText ?? "";

  return (
    withSource(findAliasMatch(captionText, config.aliases), "caption") ??
    withSource(findAliasMatch(ocrText, config.aliases), "ocr") ??
    findAmbiguousMatch(captionText, config.ambiguousAliases) ??
    findAmbiguousMatch(ocrText, config.ambiguousAliases) ?? {
      paymentMethod: "",
      source: "none"
    }
  );
}
