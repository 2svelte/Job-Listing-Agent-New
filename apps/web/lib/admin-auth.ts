import { NextRequest } from "next/server";
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
