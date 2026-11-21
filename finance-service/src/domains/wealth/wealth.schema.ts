import { z } from "zod";

export const wealthPlatforms = ["jago", "bca", "jenius", "stockbit", "bibit", "pluang", "other"] as const;
export const wealthAssetTypes = [
  "cash",
  "stocks",
  "mutual_fund",
  "crypto",
  "gold",
  "deposit",
  "other"
] as const;

export const WealthSnapshotPayloadSchema = z.object({
  schema_version: z.literal("wealth_snapshot.v1"),
  snapshot_id: z.string().min(1),
  source: z.object({
    platform: z.string().min(1),
    chat_id: z.string().min(1),
    message_id: z.string().min(1),
    received_at: z.string().min(1)
  }),
  uploaded_at: z.string().min(1),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  month_key: z.string().regex(/^\d{4}-\d{2}$/),
  platform: z.enum(wealthPlatforms).or(z.string().min(1)),
  account_name: z.string().default(""),
  asset_type: z.enum(wealthAssetTypes).or(z.string().min(1)),
  amount: z.number().int().nonnegative(),
  currency: z.literal("IDR").default("IDR"),
  source_type: z.enum(["text", "image", "pdf"]).default("text"),
  confidence: z.number().min(0).max(1),
  raw_json: z.record(z.string(), z.any()).default({})
});

export type WealthSnapshotPayload = z.infer<typeof WealthSnapshotPayloadSchema>;

export function validateWealthSnapshotV1(payload: unknown): WealthSnapshotPayload {
  return WealthSnapshotPayloadSchema.parse(payload);
}
