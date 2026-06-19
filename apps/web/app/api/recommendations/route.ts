import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { scoreJobs, type InteractionRecord, type JobRecord, type PreferenceRecord } from "@/lib/recommendations/score";

const querySchema = z.object({
  userId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing or invalid query params", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { userId, limit } = parsed.data;
  const supabase = getSupabaseAdminClient();

  const [preferencesResult, interactionsResult, jobsResult] = await Promise.all([
    supabase.from("job_preferences").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("job_interactions")
      .select("job_id,interaction_type,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("jobs")
      .select("id,title,location,remote_type,employment_type,salary_min,salary_max,is_active,tags,posted_at")
      .eq("is_active", true)
      .order("posted_at", { ascending: false })
      .limit(400),
  ]);

  if (preferencesResult.error) {
    return NextResponse.json({ error: preferencesResult.error.message }, { status: 500 });
  }

  if (interactionsResult.error) {
    return NextResponse.json({ error: interactionsResult.error.message }, { status: 500 });
  }

  if (jobsResult.error) {
    return NextResponse.json({ error: jobsResult.error.message }, { status: 500 });
  }

  const scoredJobs = scoreJobs(
    (jobsResult.data ?? []) as JobRecord[],
    (preferencesResult.data ?? null) as PreferenceRecord | null,
    (interactionsResult.data ?? []) as InteractionRecord[],
  ).slice(0, limit);

  const jobIds = scoredJobs.map((item) => item.jobId);
  if (!jobIds.length) {
    return NextResponse.json({ recommendations: [] });
  }

  const { data: jobsById, error: jobsByIdError } = await supabase
    .from("jobs")
    .select("id,title,company_name,location,remote_type,employment_type,salary_min,salary_max,currency,source,source_url,tags,posted_at")
    .in("id", jobIds);

  if (jobsByIdError) {
    return NextResponse.json({ error: jobsByIdError.message }, { status: 500 });
  }

  const mappedJobs = new Map((jobsById ?? []).map((job) => [job.id, job]));

  const recommendations = scoredJobs
    .map((item) => {
      const job = mappedJobs.get(item.jobId);
      if (!job) {
        return null;
      }

      return {
        score: Number(item.score.toFixed(4)),
        reasons: item.reasons,
        job,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ recommendations });
}
