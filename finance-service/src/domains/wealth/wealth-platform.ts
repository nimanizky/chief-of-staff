import { wealthAssetTypes, wealthPlatforms } from "./wealth.schema.js";

export function getWealthPlatforms(): string[] {
  return [...wealthPlatforms].filter((platform) => platform !== "other");
}

export function isWealthPlatform(value: string): boolean {
  return wealthPlatforms.includes(value as (typeof wealthPlatforms)[number]);
}

export function normalizeWealthPlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/\bbank\s+jago\b|\bjago\b/.test(normalized)) return "jago";
  if (/\bbca\b|\bbank\s+central\s+asia\b/.test(normalized)) return "bca";
  if (/\bjenius\b|\bbtpn\b/.test(normalized)) return "jenius";
  if (/\bstockbit\b/.test(normalized)) return "stockbit";
  if (/\bbibit\b/.test(normalized)) return "bibit";
  if (/\bpluang\b/.test(normalized)) return "pluang";
  return "";
}

export function normalizeWealthAssetType(value: string, platform = ""): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (wealthAssetTypes.includes(normalized as (typeof wealthAssetTypes)[number])) return normalized;
  if (/\bcash|saldo|tabungan|rekening|pocket|rdi\b/.test(normalized)) return "cash";
  if (/\bsaham|stock|stocks|equity|portfolio\b/.test(normalized)) return "stocks";
  if (/\breksa\s*dana|reksadana|mutual\s*fund\b/.test(normalized)) return "mutual_fund";
  if (/\bcrypto|btc|bitcoin|eth|ethereum\b/.test(normalized)) return "crypto";
  if (/\bgold|emas\b/.test(normalized)) return "gold";
  if (/\bdeposit|deposito\b/.test(normalized)) return "deposit";
  if (platform === "stockbit") return "stocks";
  if (platform === "bibit") return "mutual_fund";
  if (platform === "jago" || platform === "bca" || platform === "jenius") return "cash";
  return "other";
}
