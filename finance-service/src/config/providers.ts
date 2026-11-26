import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ReceiptProviderSchema = z.enum(["mistral", "google"]);

const ProvidersConfigSchema = z.object({
  defaultProvider: ReceiptProviderSchema,
  models: z.object({
    receipt_intake: z.string().min(1)
  }),
  requiredEnv: z.array(z.string().min(1)).default([])
});

export type ReceiptProvider = z.infer<typeof ReceiptProviderSchema>;

export type ReceiptModelConfig = {
  provider: ReceiptProvider;
  model: string;
};

function loadProvidersConfig() {
  const configPath = resolve(process.cwd(), "config/providers.json");
  const raw = readFileSync(configPath, "utf8");
  const parsed = ProvidersConfigSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) {
    throw new Error(`Invalid providers config: ${parsed.error.message}`);
  }

  for (const envName of parsed.data.requiredEnv) {
    if (!process.env[envName]?.trim()) {
      throw new Error(`Missing required environment variable from providers config: ${envName}`);
    }
  }

  return parsed.data;
}

export function getReceiptModelConfig(): ReceiptModelConfig {
  const providers = loadProvidersConfig();
  return {
    provider: providers.defaultProvider,
    model: providers.models.receipt_intake
  };
}
