import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const interactionBodySchema = z.object({
  userId: z.string().uuid(),
  interactionType: z.enum(["saved", "liked", "disliked", "applied", "viewed"]),
});

const interactionDeleteSchema = z.object({
  userId: z.string().uuid(),
  interactionType: z.enum(["saved", "liked", "disliked"]),
});

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  const body = await request.json().catch(() => null);

  const parsed = interactionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid interaction payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { userId, interactionType } = parsed.data;

  const { data, error } = await supabase
    .from("job_interactions")
    .upsert(
      {
        user_id: userId,
        job_id: jobId,
        interaction_type: interactionType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,job_id,interaction_type" },
    )
    .select("id,user_id,job_id,interaction_type,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ interaction: data });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  const parsed = interactionDeleteSchema.safeParse({
    userId: request.nextUrl.searchParams.get("userId"),
    interactionType: request.nextUrl.searchParams.get("interactionType"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid delete interaction query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { userId, interactionType } = parsed.data;

  const { error } = await supabase
    .from("job_interactions")
    .delete()
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("interaction_type", interactionType);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
