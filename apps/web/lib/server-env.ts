import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  CRON_SECRET: z.string().trim().min(16).optional(),
  AI_API_KEY: z.string().trim().min(1).optional(),
  AI_MODEL: z.string().trim().min(1).optional().default("gpt-4o-mini"),
  AI_BASE_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .default("https://api.openai.com/v1")
    .transform((value) => value.replace(/\/+$/, "")),
  AI_REVIEW_PER_SYNC: z.coerce.number().int().min(0).max(200).optional().default(25),
  ADZUNA_APP_ID: z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim();
      return normalized ? normalized : undefined;
    }),
  ADZUNA_APP_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim();
      return normalized ? normalized : undefined;
    }),
  ADZUNA_COUNTRY: z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim();
      return normalized ? normalized : "au";
    }),
  ADZUNA_RESULTS_PER_PAGE: z.coerce.number().int().min(1).max(50).optional().default(50),
});

export const serverEnv = serverEnvSchema.parse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  CRON_SECRET: process.env.CRON_SECRET || undefined,
  AI_API_KEY: process.env.AI_API_KEY || undefined,
  AI_MODEL: process.env.AI_MODEL || undefined,
  AI_BASE_URL: process.env.AI_BASE_URL || undefined,
  AI_REVIEW_PER_SYNC: process.env.AI_REVIEW_PER_SYNC || undefined,
  ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
  ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
  ADZUNA_COUNTRY: process.env.ADZUNA_COUNTRY,
  ADZUNA_RESULTS_PER_PAGE: process.env.ADZUNA_RESULTS_PER_PAGE,
});
