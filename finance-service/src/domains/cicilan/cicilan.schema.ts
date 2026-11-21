import { z } from "zod";

export const CicilanPayloadSchema = z.object({
  schema_version: z.literal("cicilan.v1"),
  cicilan_id: z.string().min(1),
  source: z.object({
    platform: z.string().min(1),
    chat_id: z.string().min(1),
    message_id: z.string().min(1),
    received_at: z.string().min(1)
  }),
  merchant_name: z.string().min(1),
  cicilan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_amount: z.number().int().positive(),
  payment_method: z.string().default(""),
  classification: z.literal("cicilan").default("cicilan"),
  confidence: z.number().min(0).max(1),
  tenor_months: z.number().int().min(1),
  month_key: z.string().regex(/^\d{4}-\d{2}$/),
  raw_json: z.record(z.string(), z.any()).default({})
});

export type CicilanPayload = z.infer<typeof CicilanPayloadSchema>;

export function validateCicilanV1(payload: unknown): CicilanPayload {
  return CicilanPayloadSchema.parse(payload);
}
