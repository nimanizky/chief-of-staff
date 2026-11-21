import { buildMonthKey } from "../receipts/receipt-date.js";
import { resolveReceiptPaymentMethod } from "../receipts/receipt-payment-method.js";
import type { CicilanPayload } from "./cicilan.schema.js";
import { validateCicilanV1 } from "./cicilan.schema.js";

const CICILAN_TRIGGER_PATTERN = /\b(?:cicil(?:an)?|installments?|paylater|spaylater|spl)\b/i;
const TENOR_PATTERN = /\b(\d{1,3})\s*(?:x|kali|bulan|bln|month|months)\b/i;
const INTEREST_PATTERN = /\b(\d+(?:[.,]\d+)?)\s*%/i;
const AMOUNT_PATTERN = /(?:rp\s*)?(\d[\d.,]*)(?:\s*(k|rb|ribu|jt|juta))?/gi;
const PAYMENT_PHRASE_PATTERNS = [
  /\bcc\s+bca\b/gi,
  /\bcredit\s+bca\b/gi,
  /\bkartu\s+kredit\s+bca\b/gi,
  /\bdb\s+bca\b/gi,
  /\bdebit\s+bca\b/gi,
  /\bcc\s+bri\b/gi,
  /\bcredit\s+bri\b/gi,
  /\bdb\s+jago\b/gi,
  /\bdebit\s+jago\b/gi,
  /\bjago\b/gi,
  /\bdb\s+cash\b/gi,
  /\bdebit\s+cash\b/gi,
  /\bcc\s+jeni(?:us)?\b/gi,
  /\bcc\b/gi,
  /\bcash\b/gi,
  /\btunai\b/gi,
  /\bshopee\s+pay\s+later\b/gi,
  /\bspaylater\b/gi,
  /\bspaylter\b/gi,
  /\bpaylater\b/gi,
  /\bspl\b/gi
];

export type BuildCicilanPayloadInput = {
  sourcePlatform: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
  text: string;
};

type AmountCandidate = {
  raw: string;
  value: number;
  index: number;
};

export function isCicilanText(text: string): boolean {
  return CICILAN_TRIGGER_PATTERN.test(text);
}

export function buildCicilanPayload(input: BuildCicilanPayloadInput): CicilanPayload {
  if (!isCicilanText(input.text)) {
    throw new Error("Cicilan trigger word is required.");
  }

  const amount = extractPrincipalAmount(input.text);
  if (!amount) {
    throw new Error("Cicilan amount is required.");
  }

  const tenor = extractTenorMonths(input.text);
  const cicilanDate = dateInJakarta(input.receivedAt);
  const paymentMethodDecision = resolveReceiptPaymentMethod({
    captionText: input.text
  });
  const merchantName = extractMerchantName(input.text, amount.raw);
  if (!merchantName) {
    throw new Error("Cicilan merchant name is required.");
  }
  const interestRateRaw = extractInterestRateRaw(input.text);

  return validateCicilanV1({
    schema_version: "cicilan.v1",
    cicilan_id: `${input.chatId}:${input.messageId}`,
    source: {
      platform: input.sourcePlatform,
      chat_id: input.chatId,
      message_id: input.messageId,
      received_at: input.receivedAt
    },
    merchant_name: merchantName,
    cicilan_date: cicilanDate,
    total_amount: amount.value,
    payment_method: paymentMethodDecision.paymentMethod,
    classification: "cicilan",
    confidence: 0.95,
    tenor_months: tenor.value,
    month_key: buildMonthKey(cicilanDate),
    raw_json: {
      raw_text: input.text,
      provider_raw: paymentMethodDecision.matchedAlias ?? "",
      payment_method_source: paymentMethodDecision.source,
      ...(paymentMethodDecision.matchedAlias
        ? { payment_method_matched_alias: paymentMethodDecision.matchedAlias }
        : {}),
      amount_raw: amount.raw,
      tenor_raw: tenor.raw,
      tenor_defaulted: tenor.defaulted,
      interest_rate_raw: interestRateRaw.value,
      interest_defaulted: interestRateRaw.defaulted,
      source_type: "text"
    }
  });
}

function extractPrincipalAmount(text: string): AmountCandidate | null {
  const candidates: AmountCandidate[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const raw = match[0];
    const suffix = match[2]?.toLowerCase();
    const value = normalizeAmount(rawNumber, suffix);
    if (value < 1000) continue;
    candidates.push({
      raw,
      value,
      index: match.index ?? 0
    });
  }

  candidates.sort((a, b) => b.value - a.value || a.index - b.index);
  return candidates[0] ?? null;
}

function normalizeAmount(rawNumber: string, suffix: string | undefined): number {
  const numeric = Number(rawNumber.replace(/[.,]/g, ""));
  const multiplier =
    suffix === "k" || suffix === "rb" || suffix === "ribu"
      ? 1_000
      : suffix === "jt" || suffix === "juta"
        ? 1_000_000
        : 1;
  return Math.round(numeric * multiplier);
}

function extractTenorMonths(text: string): { value: number; raw: string; defaulted: boolean } {
  const match = text.match(TENOR_PATTERN);
  const value = Number(match?.[1] ?? 1);
  return {
    value: Number.isFinite(value) && value > 0 ? Math.floor(value) : 1,
    raw: match?.[0] ?? "1 bulan",
    defaulted: !match
  };
}

function extractInterestRateRaw(text: string): { value: string; defaulted: boolean } {
  const match = text.match(INTEREST_PATTERN);
  return {
    value: match?.[0] ?? "0%",
    defaulted: !match
  };
}

function extractMerchantName(text: string, amountRaw: string): string {
  let merchant = text
    .replace(CICILAN_TRIGGER_PATTERN, " ")
    .replace(TENOR_PATTERN, " ")
    .replace(INTEREST_PATTERN, " ")
    .replace(escapeRegExp(amountRaw), " ");

  for (const pattern of PAYMENT_PHRASE_PATTERNS) {
    merchant = merchant.replace(pattern, " ");
  }

  return merchant
    .replace(/\bor\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function dateInJakarta(receivedAt: string): string {
  const date = new Date(receivedAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(Number.isNaN(date.getTime()) ? new Date() : date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
