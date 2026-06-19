import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const bootstrapSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bootstrap payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { userId, email } = parsed.data;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("id,email,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
