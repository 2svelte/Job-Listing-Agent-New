import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyVisaWithAi, isAiConfigured } from "./ai";
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

// Asks the AI about jobs the rules flagged as unclear. Failures leave the job flagged for a later run.
export const runAiVisaReview = async (limit: number) => {
  if (!isAiConfigured() || limit <= 0) {
    return { reviewed: 0, failed: 0 };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,title,description")
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
      const requirement = await classifyVisaWithAi(String(job.title ?? ""), String(job.description ?? ""));
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
