import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminRequest } from "@/lib/admin-auth";
import { runAiVisaReview, runFullTextReview, visaColumnsFromRules } from "@/lib/visa";

export const maxDuration = 300;

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

const bodySchema = z.object({
  aiLimit: z.number().int().min(0).max(500).optional().default(50),
  fetchLimit: z.number().int().min(0).max(300).optional().default(100),
});

// Classifies jobs that have never been checked (e.g. synced before this feature existed),
// then lets the AI settle jobs the rules flagged as unclear.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const counts = { restricted: 0, open: 0, unknown: 0, needsReview: 0 };

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,description")
      .is("visa_classified_by", null)
      .limit(BATCH_SIZE);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.length) {
      break;
    }

    const groups = new Map<string, { columns: ReturnType<typeof visaColumnsFromRules>; ids: string[] }>();
    for (const job of data) {
      const columns = visaColumnsFromRules(job.title as string, job.description as string);
      const key = `${columns.visa_requirement}:${columns.visa_needs_review}`;
      const group = groups.get(key) ?? { columns, ids: [] };
      group.ids.push(job.id as string);
      groups.set(key, group);
    }

    for (const { columns, ids } of groups.values()) {
      const { error: updateError } = await supabase.from("jobs").update(columns).in("id", ids);
      if (updateError) {
        return NextResponse.json({ error: updateError.message, counts }, { status: 500 });
      }

      if (columns.visa_needs_review) {
        counts.needsReview += ids.length;
      } else {
        counts[columns.visa_requirement] += ids.length;
      }
    }
  }

  let fullText = { fetched: 0, failed: 0, restricted: 0, open: 0 };
  let aiReview = { reviewed: 0, failed: 0 };
  try {
    fullText = await runFullTextReview(parsed.data.fetchLimit);
    aiReview = await runAiVisaReview(parsed.data.aiLimit);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI review failed", counts },
      { status: 500 },
    );
  }

  return NextResponse.json({ classifiedByRules: counts, fullText, aiReview });
}
