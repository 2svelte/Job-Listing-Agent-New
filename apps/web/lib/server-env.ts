import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  SYNC_ADMIN_SECRET: z.string().min(1).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SYNC_ADMIN_SECRET: process.env.SYNC_ADMIN_SECRET,
});
