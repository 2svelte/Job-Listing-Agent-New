import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { serverEnv } from "@/lib/server-env";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const isAdminRequest = async (request: NextRequest) => {
  if (LOCAL_HOSTS.has(request.nextUrl.hostname)) {
    return true;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return false;
  }

  // Scheduled jobs (Vercel Cron sends CRON_SECRET as a bearer token)
  const cronSecret = serverEnv.CRON_SECRET;
  if (cronSecret) {
    const a = Buffer.from(token);
    const b = Buffer.from(cronSecret);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  }

  const supabase = getSupabaseAdminClient();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) {
    return false;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  return Boolean(profile?.is_admin);
};
