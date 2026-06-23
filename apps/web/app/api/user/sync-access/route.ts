import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export async function GET(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  if (LOCAL_HOSTS.has(hostname)) {
    return NextResponse.json({ canAccessSyncPanel: true, reason: "localhost" });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return NextResponse.json({ canAccessSyncPanel: false, reason: "missing-token" }, { status: 401 });
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return NextResponse.json({ canAccessSyncPanel: false, reason: "missing-token" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ canAccessSyncPanel: false, reason: "invalid-token" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ canAccessSyncPanel: false, reason: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ canAccessSyncPanel: Boolean(profile?.is_admin), reason: "profile-flag" });
}
