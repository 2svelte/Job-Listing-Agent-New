import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  CRON_SECRET: z.string().trim().min(16).optional(),
  SERPAPI_KEY: z.string().trim().min(1).optional(),
  SERPAPI_MONTHLY_LIMIT: z.coerce.number().int().positive().optional().default(240),
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
  SERPAPI_KEY: process.env.SERPAPI_KEY || undefined,
  SERPAPI_MONTHLY_LIMIT: process.env.SERPAPI_MONTHLY_LIMIT || undefined,
  ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
  ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
  ADZUNA_COUNTRY: process.env.ADZUNA_COUNTRY,
  ADZUNA_RESULTS_PER_PAGE: process.env.ADZUNA_RESULTS_PER_PAGE,
});
