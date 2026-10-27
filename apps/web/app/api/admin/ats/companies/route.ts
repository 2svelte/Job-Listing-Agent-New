import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminRequest } from "@/lib/admin-auth";
import { ATS_PROVIDERS, parseAtsUrl } from "@/lib/ats";

const companySchema = z.union([
  z.object({
    name: z.string().min(1).max(255),
    atsProvider: z.enum(ATS_PROVIDERS as [string, ...string[]]),
    boardToken: z.string().min(1).max(255),
  }),
  z.object({
    name: z.string().min(1).max(255).optional(),
    url: z.string().min(1).max(500),
  }),
]);

const bodySchema = z.object({ companies: z.array(companySchema).min(1).max(500) });

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("tracked_companies")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ companies: data ?? [] });
}

// Seed companies by explicit provider/token or by pasting a careers-board URL
// (e.g. https://boards.greenhouse.io/stripe).
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const rows: Array<{ name: string; ats_provider: string; board_token: string }> = [];
  const rejected: string[] = [];

  for (const item of parsed.data.companies) {
    if ("url" in item) {
      const ats = parseAtsUrl(item.url);
      if (!ats) {
        rejected.push(item.url);
        continue;
      }
      rows.push({ name: item.name ?? ats.token, ats_provider: ats.provider, board_token: ats.token });
    } else {
      rows.push({ name: item.name, ats_provider: item.atsProvider, board_token: item.boardToken.toLowerCase() });
    }
  }

  if (rows.length) {
    const { error } = await getSupabaseAdminClient()
      .from("tracked_companies")
      .upsert(rows, { onConflict: "ats_provider,board_token", ignoreDuplicates: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ added: rows.length, rejected });
}
