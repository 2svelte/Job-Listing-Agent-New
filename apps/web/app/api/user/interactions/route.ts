import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const querySchema = z.object({
  userId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(250).default(100),
  interactionType: z.enum(["saved", "liked", "disliked", "applied", "viewed"]).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { userId, limit, interactionType } = parsed.data;
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("job_interactions")
    .select("id,job_id,interaction_type,created_at,updated_at,jobs(id,title,company_name,location,source_url)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (interactionType) {
    query = query.eq("interaction_type", interactionType);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ interactions: data ?? [] });
}
