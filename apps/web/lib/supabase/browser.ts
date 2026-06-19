"use client";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/public-env";

let client: ReturnType<typeof createClient> | null = null;

export const getSupabaseBrowserClient = () => {
  if (client) {
    return client;
  }

  client = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISH_KEY,
  );

  return client;
};
