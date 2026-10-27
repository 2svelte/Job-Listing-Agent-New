import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminRequest } from "@/lib/admin-auth";
import { ATS_PROVIDERS, fetchAtsJobs, type AtsProvider } from "@/lib/ats";

const CONCURRENCY = 5;

const bodySchema = z.object({
  names: z.array(z.string().min(1).max(255)).min(1).max(200),
  register: z.boolean().optional().default(true),
});

const slugVariants = (name: string) => {
  const lower = name.trim().toLowerCase();
  const variants = new Set([
    lower.replace(/[^a-z0-9]+/g, ""),
    lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  ]);
  variants.delete("");
  return Array.from(variants);
};

type Match = { name: string; provider: AtsProvider; token: string; jobCount: number };

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { register } = parsed.data;
  const queue = [...new Set(parsed.data.names.map((n) => n.trim()).filter(Boolean))];
  const matches: Match[] = [];
  const notFound: string[] = [];

  const probe = async (name: string) => {
    for (const token of slugVariants(name)) {
      for (const provider of ATS_PROVIDERS) {
        try {
          const jobs = await fetchAtsJobs(provider, token, name);
          matches.push({ name, provider, token, jobCount: jobs.length });
          return;
        } catch {
          // 404 or transient failure: try the next provider/slug
        }
      }
    }
    notFound.push(name);
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        await probe(name);
      }
    }),
  );

  if (register && matches.length) {
    const { error } = await getSupabaseAdminClient()
      .from("tracked_companies")
      .upsert(
        matches.map((m) => ({ name: m.name, ats_provider: m.provider, board_token: m.token })),
        { onConflict: "ats_provider,board_token", ignoreDuplicates: true },
      );
    if (error) {
      return NextResponse.json({ error: error.message, matches, notFound }, { status: 500 });
    }
  }

  return NextResponse.json({ registered: register ? matches.length : 0, matches, notFound });
}
