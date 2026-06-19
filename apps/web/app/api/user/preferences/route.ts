import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const preferencesSchema = z.object({
  preferredTitles: z.array(z.string().min(1)).default([]),
  preferredJobTypes: z.array(z.string().min(1)).default([]),
  preferredLocations: z.array(z.string().min(1)).default([]),
  preferredRemoteTypes: z.array(z.enum(["remote", "hybrid", "onsite"])).default([]),
  minSalary: z.number().int().nonnegative().nullable().default(null),
  maxSalary: z.number().int().nonnegative().nullable().default(null),
  preferredTags: z.array(z.string().min(1)).default([]),
});

const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const parsed = userParamsSchema.safeParse({
    userId: request.nextUrl.searchParams.get("userId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid userId" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("job_preferences")
    .select("*")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preferences: data });
}

export async function PUT(request: NextRequest) {
  const userParse = userParamsSchema.safeParse({
    userId: request.nextUrl.searchParams.get("userId"),
  });
  if (!userParse.success) {
    return NextResponse.json({ error: "Missing or invalid userId" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const preferenceParse = preferencesSchema.safeParse(body);
  if (!preferenceParse.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: preferenceParse.error.flatten() },
      { status: 400 },
    );
  }

  const payload = preferenceParse.data;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("job_preferences")
    .upsert(
      {
        user_id: userParse.data.userId,
        preferred_titles: payload.preferredTitles,
        preferred_job_types: payload.preferredJobTypes,
        preferred_locations: payload.preferredLocations,
        preferred_remote_types: payload.preferredRemoteTypes,
        min_salary: payload.minSalary,
        max_salary: payload.maxSalary,
        preferred_tags: payload.preferredTags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preferences: data });
}
