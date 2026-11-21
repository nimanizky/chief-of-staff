import { buildMonthKey } from "../receipts/receipt-date.js";
import { normalizeWealthAssetType, normalizeWealthPlatform } from "./wealth-platform.js";
import type { WealthSnapshotPayload } from "./wealth.schema.js";
import { validateWealthSnapshotV1 } from "./wealth.schema.js";

const WEALTH_TRIGGER_PATTERN = /(?:^|\s)(?:\/wealth(?:@\w+)?|wealth|net\s*worth|asset|aset|saldo|portfolio|portofolio)(?:\s|$)/i;
const AMOUNT_PATTERN = /(?:rp\s*)?(\d[\d.,]*)(?:\s*(k|rb|ribu|jt|juta|m|miliar|b|billion))?/gi;
const PLATFORM_PATTERN = /\b(?:bank\s+jago|jago|bca|jenius|btpn|stockbit|bibit|pluang)\b/i;
const ASSET_PATTERN = /\b(?:cash|saldo|tabungan|pocket|saham|stocks?|portfolio|portofolio|reksa\s*dana|reksadana|mutual\s*fund|crypto|gold|emas|deposito?)\b/i;

export type BuildWealthSnapshotTextInput = {
  sourcePlatform: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
  text: string;
};

export type WealthParseCandidate = {
  platform: string;
  account_name: string;
  asset_type: string;
  amount: number;
  snapshot_date: string;
  raw_text: string;
  confidence: number;
};

export type BuildWealthSnapshotCandidateInput = {
  sourcePlatform: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
  candidate: WealthParseCandidate;
  captionText?: string;
  sourceType: "image" | "pdf";
  pdfPageNumber?: number;
  pdfTotalPages?: number | null;
  pdfTruncated?: boolean;
};

type AmountCandidate = {
  raw: string;
  value: number;
  index: number;
};

export function isWealthText(text: string): boolean {
  return WEALTH_TRIGGER_PATTERN.test(text);
}

export function buildWealthSnapshotFromText(input: BuildWealthSnapshotTextInput): WealthSnapshotPayload {
  if (!isWealthText(input.text)) {
    throw new Error("Wealth trigger word is required.");
  }

  const amount = extractAmount(input.text);
  if (!amount) {
    throw new Error("Wealth amount is required.");
  }

  const platformRaw = input.text.match(PLATFORM_PATTERN)?.[0] ?? "";
  const platform = normalizeWealthPlatform(platformRaw);
  const snapshotDate = dateInJakarta(input.receivedAt);
  const assetRaw = input.text.match(ASSET_PATTERN)?.[0] ?? "";
  const assetType = normalizeWealthAssetType(assetRaw, platform);
  const accountName = extractAccountName(input.text, amount.raw, platformRaw, assetRaw);

  return validateWealthSnapshotV1({
    schema_version: "wealth_snapshot.v1",
    snapshot_id: `${input.chatId}:${input.messageId}`,
    source: {
      platform: input.sourcePlatform,
      chat_id: input.chatId,
      message_id: input.messageId,
      received_at: input.receivedAt
    },
    uploaded_at: input.receivedAt,
    snapshot_date: snapshotDate,
    month_key: buildMonthKey(snapshotDate),
    platform,
    account_name: accountName || platform,
    asset_type: assetType,
    amount: amount.value,
    currency: "IDR",
    source_type: "text",
    confidence: platform ? 0.95 : 0.72,
    raw_json: {
      raw_text: input.text,
      platform_raw: platformRaw,
      amount_raw: amount.raw,
      asset_raw: assetRaw,
      platform_source: platform ? "text" : "missing",
      source_type: "text"
    }
  });
}

export function buildWealthSnapshotFromCandidate(
  input: BuildWealthSnapshotCandidateInput
): WealthSnapshotPayload {
  const platform =
    normalizeWealthPlatform(input.captionText ?? "") || normalizeWealthPlatform(input.candidate.platform);
  const snapshotDate = normalizeSnapshotDate(input.candidate.snapshot_date, input.receivedAt);
  const assetType = normalizeWealthAssetType(input.candidate.asset_type, platform);

  return validateWealthSnapshotV1({
    schema_version: "wealth_snapshot.v1",
    snapshot_id: `${input.chatId}:${input.messageId}`,
    source: {
      platform: input.sourcePlatform,
      chat_id: input.chatId,
      message_id: input.messageId,
      received_at: input.receivedAt
    },
    uploaded_at: input.receivedAt,
    snapshot_date: snapshotDate,
    month_key: buildMonthKey(snapshotDate),
    platform,
    account_name: input.candidate.account_name || platform,
    asset_type: assetType,
    amount: Math.round(input.candidate.amount),
    currency: "IDR",
    source_type: input.sourceType,
    confidence: input.candidate.confidence,
    raw_json: {
      raw_text: input.candidate.raw_text,
      model_platform: input.candidate.platform,
      model_asset_type: input.candidate.asset_type,
      ...(input.captionText ? { caption_text: input.captionText } : {}),
      ...(input.pdfPageNumber ? { pdf_page_number: input.pdfPageNumber } : {}),
      ...(input.pdfTotalPages !== undefined ? { pdf_total_pages: input.pdfTotalPages } : {}),
      ...(input.pdfTruncated !== undefined ? { pdf_truncated: input.pdfTruncated } : {}),
      source_type: input.sourceType
    }
  });
}

function extractAmount(text: string): AmountCandidate | null {
  const candidates: AmountCandidate[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const raw = match[0];
    const suffix = match[2]?.toLowerCase();
    const value = normalizeAmount(rawNumber, suffix);
    if (value < 1_000) continue;
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
  const hasSuffix = Boolean(suffix);
  const numeric =
    hasSuffix && /^\d+[.,]\d{1,2}$/.test(rawNumber)
      ? Number(rawNumber.replace(",", "."))
      : Number(rawNumber.replace(/[.,]/g, ""));
  const multiplier =
    suffix === "k" || suffix === "rb" || suffix === "ribu"
      ? 1_000
      : suffix === "jt" || suffix === "juta"
        ? 1_000_000
        : suffix === "m" || suffix === "miliar" || suffix === "b" || suffix === "billion"
          ? 1_000_000_000
          : 1;
  return Math.round(numeric * multiplier);
}

function extractAccountName(text: string, amountRaw: string, platformRaw: string, assetRaw: string): string {
  return text
    .replace(WEALTH_TRIGGER_PATTERN, " ")
    .replace(escapeRegExp(amountRaw), " ")
    .replace(platformRaw ? escapeRegExp(platformRaw) : /$^/, " ")
    .replace(assetRaw ? escapeRegExp(assetRaw) : /$^/, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeSnapshotDate(value: string, receivedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateInJakarta(receivedAt);
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
