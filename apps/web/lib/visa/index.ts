import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyVisaWithAi, isAiConfigured } from "./ai";
import { fetchJobPageText } from "./page-text";
import { classifyVisaByRules } from "./rules";

export { classifyVisaByRules } from "./rules";
export type { VisaClassification, VisaRequirement } from "./rules";

export const visaColumnsFromRules = (title: string | null | undefined, description: string | null | undefined) => {
  const result = classifyVisaByRules(title, description);
  return {
    visa_requirement: result.requirement,
    visa_needs_review: result.needsReview,
    visa_classified_by: "rules" as const,
  };
};

const FETCH_CONCURRENCY = 4;

// Downloads the full job page for jobs the snippet couldn't settle, then re-runs the rules on the full text.
export const runFullTextReview = async (limit: number) => {
  if (limit <= 0) {
    return { fetched: 0, failed: 0, restricted: 0, open: 0 };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,title,source_url")
    .eq("is_active", true)
    .eq("visa_requirement", "unknown")
    .is("full_text_status", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const jobs = data ?? [];
  const result = { fetched: 0, failed: 0, restricted: 0, open: 0 };

  for (let i = 0; i < jobs.length; i += FETCH_CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + FETCH_CONCURRENCY).map(async (job) => {
        const now = new Date().toISOString();
        const text = await fetchJobPageText(String(job.source_url ?? ""));

        if (!text) {
          result.failed += 1;
          await supabase
            .from("jobs")
            .update({ full_text_status: "failed", full_text_fetched_at: now })
            .eq("id", job.id as string);
          return;
        }

        const columns = visaColumnsFromRules(String(job.title ?? ""), text);
        result.fetched += 1;
        if (columns.visa_requirement === "restricted") {
          result.restricted += 1;
        } else if (columns.visa_requirement === "open") {
          result.open += 1;
        }

        await supabase
          .from("jobs")
          .update({ ...columns, full_description: text, full_text_status: "fetched", full_text_fetched_at: now })
          .eq("id", job.id as string);
      }),
    );
  }

  return result;
};

// Asks the AI about jobs the rules flagged as unclear. Failures leave the job flagged for a later run.
export const runAiVisaReview = async (limit: number) => {
  if (!isAiConfigured() || limit <= 0) {
    return { reviewed: 0, failed: 0 };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,title,description,full_description")
    .eq("visa_needs_review", true)
    .eq("is_active", true)
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let reviewed = 0;
  let failed = 0;

  for (const job of data ?? []) {
    try {
      const requirement = await classifyVisaWithAi(String(job.title ?? ""), String(job.full_description ?? job.description ?? ""));
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ visa_requirement: requirement, visa_needs_review: false, visa_classified_by: "ai" })
        .eq("id", job.id as string);
      if (updateError) {
        throw new Error(updateError.message);
      }
      reviewed += 1;
    } catch {
      failed += 1;
    }
  }

  return { reviewed, failed };
};
