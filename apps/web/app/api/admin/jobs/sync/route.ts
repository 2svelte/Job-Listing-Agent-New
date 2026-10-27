import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { isAdminRequest } from "@/lib/admin-auth";
import { runAiVisaReview, runFullTextReview, visaColumnsFromRules } from "@/lib/visa";
import { DEFAULT_SYNC_PAGES, isMetroMelbourne, SYNC_LOCATION, SYNC_TITLES } from "@/lib/sync-targets";

export const maxDuration = 300;

const ADZUNA_API_BASE_URL = "https://api.adzuna.com/v1/api/jobs";
const ADZUNA_SOURCE = "adzuna";
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

const syncBodySchema = z.object({
  pages: z.number().int().positive().max(5).optional(),
  what: z.string().min(1).max(120).optional(),
  whatExclude: z.string().min(1).max(120).optional(),
  where: z.string().min(1).max(120).optional(),
  sortBy: z.enum(["salary", "date", "relevance"]).optional(),
  salaryMin: z.number().int().nonnegative().optional(),
  fullTime: z.boolean().optional(),
  permanent: z.boolean().optional(),
  force: z.boolean().optional().default(false),
});

type AdzunaJob = {
  id: string | number;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  category?: { label?: string };
  contract_type?: string;
  salary_min?: number;
  salary_max?: number;
};

type AdzunaResponse = {
  results?: AdzunaJob[];
};

type SyncRunInsert = {
  source: string;
  status: "started" | "success" | "failed" | "skipped";
  requested_pages?: number;
  country?: string;
  fetched_count?: number;
  upserted_count?: number;
  finished_at?: string;
  error_message?: string;
};

const normalizeRemoteType = (title: string, description: string) => {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes("remote")) {
    return "remote";
  }

  if (text.includes("hybrid")) {
    return "hybrid";
  }

  return "onsite";
};

const buildTags = (job: AdzunaJob) => {
  const tags = new Set<string>();

  if (job.category?.label) {
    tags.add(job.category.label);
  }

  if (job.contract_type) {
    tags.add(job.contract_type);
  }

  return Array.from(tags);
};

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!serverEnv.ADZUNA_APP_ID || !serverEnv.ADZUNA_APP_KEY) {
    return NextResponse.json(
      {
        error: "Adzuna is not configured. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in apps/web/.env.local",
      },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = syncBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { what, whatExclude, where, sortBy, salaryMin, fullTime, permanent, force } = parsed.data;
  const bodyHasPages = parsed.data.pages !== undefined;
  const pages = parsed.data.pages ?? 1;

  const supabase = getSupabaseAdminClient();

  if (!force) {
    const { data: latestRun, error: latestRunError } = await supabase
      .from("job_sync_runs")
      .select("started_at")
      .eq("source", ADZUNA_SOURCE)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRunError) {
      return NextResponse.json({ error: latestRunError.message }, { status: 500 });
    }

    if (latestRun?.started_at && typeof latestRun.started_at === "string") {
      const lastSync = new Date(latestRun.started_at).getTime();
      if (Number.isFinite(lastSync) && Date.now() - lastSync < SYNC_WINDOW_MS) {
        const nextSyncAt = new Date(lastSync + SYNC_WINDOW_MS).toISOString();
        const skippedRun: SyncRunInsert = {
          source: ADZUNA_SOURCE,
          status: "skipped",
          requested_pages: pages,
          country: serverEnv.ADZUNA_COUNTRY,
          fetched_count: 0,
          upserted_count: 0,
          finished_at: new Date().toISOString(),
          error_message: `Skipped due to 24-hour cache window. Next sync after ${nextSyncAt}`,
        };

        await supabase.from("job_sync_runs").insert(skippedRun);

        return NextResponse.json({
          skipped: true,
          reason: "Daily cache window active",
          nextSyncAt,
        });
      }
    }
  }

  const syncRunStart: SyncRunInsert = {
    source: ADZUNA_SOURCE,
    status: "started",
    requested_pages: pages,
    country: serverEnv.ADZUNA_COUNTRY,
  };

  const { data: runData, error: runStartError } = await supabase
    .from("job_sync_runs")
    .insert(syncRunStart)
    .select("id")
    .single();

  if (runStartError || !runData?.id) {
    return NextResponse.json({ error: runStartError?.message ?? "Unable to create sync run" }, { status: 500 });
  }

  const runId = runData.id;

  try {
    const adzunaJobs: AdzunaJob[] = [];
    const seenIds = new Set<string>();
    const searchErrors: string[] = [];

    // A request with its own filters runs one search; otherwise run every target title in Melbourne.
    const customSearch = Boolean(what || where);
    const searches = customSearch
      ? [{ what, titleOnly: false, where }]
      : SYNC_TITLES.map((title) => ({ what: title, titleOnly: true, where: SYNC_LOCATION }));
    const pagesPerSearch = customSearch ? pages : bodyHasPages ? pages : DEFAULT_SYNC_PAGES;

    for (const search of searches) {
      try {
        for (let page = 1; page <= pagesPerSearch; page += 1) {
          const params = new URLSearchParams({
            app_id: serverEnv.ADZUNA_APP_ID,
            app_key: serverEnv.ADZUNA_APP_KEY,
            results_per_page: String(serverEnv.ADZUNA_RESULTS_PER_PAGE),
            "content-type": "application/json",
          });

          if (search.what) {
            params.set(search.titleOnly ? "title_only" : "what", search.what);
          }

          if (search.where) {
            params.set("where", search.where);
          }

          if (whatExclude) {
            params.set("what_exclude", whatExclude);
          }

          params.set("sort_by", sortBy ?? (customSearch ? "relevance" : "date"));

          if (typeof salaryMin === "number") {
            params.set("salary_min", String(salaryMin));
          }

          if (fullTime) {
            params.set("full_time", "1");
          }

          if (permanent) {
            params.set("permanent", "1");
          }

          let response: Response | undefined;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            response = await fetch(
              `${ADZUNA_API_BASE_URL}/${serverEnv.ADZUNA_COUNTRY}/search/${page}?${params.toString()}`,
              {
                method: "GET",
                headers: {
                  Accept: "application/json",
                },
                cache: "no-store",
              },
            );

            if (response.status < 500 && response.status !== 429) {
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          }

          if (!response?.ok) {
            throw new Error(`Adzuna request failed with status ${response?.status}`);
          }

          const payload = (await response.json()) as AdzunaResponse;
          const pageJobs = payload.results ?? [];
          for (const job of pageJobs) {
            const id = String(job.id);
            if (!seenIds.has(id) && (customSearch || isMetroMelbourne(job.location?.area))) {
              seenIds.add(id);
              adzunaJobs.push(job);
            }
          }

          if (!pageJobs.length) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (searchError) {
        searchErrors.push(`${search.what ?? "all"}: ${searchError instanceof Error ? searchError.message : "failed"}`);
      }
    }

    if (searchErrors.length === searches.length) {
      throw new Error(`All Adzuna searches failed. ${searchErrors[0]}`);
    }

    const mappedJobs = adzunaJobs.map((job) => {
      const location = job.location?.display_name ?? null;
      const description = job.description ?? "";
      const title = job.title ?? "Untitled role";

      return {
        source: ADZUNA_SOURCE,
        source_job_id: String(job.id),
        source_url: job.redirect_url,
        title,
        company_name: job.company?.display_name ?? "Unknown company",
        description,
        location,
        remote_type: normalizeRemoteType(title, description),
        employment_type: job.contract_type ?? null,
        salary_min: Number.isFinite(job.salary_min) ? job.salary_min : null,
        salary_max: Number.isFinite(job.salary_max) ? job.salary_max : null,
        currency: "AUD",
        tags: buildTags(job),
        category: job.category?.label ?? null,
        posted_at: job.created ?? null,
        last_synced_at: new Date().toISOString(),
        is_active: true,
        ...visaColumnsFromRules(title, description),
      };
    });

    // Keep earlier verdicts (AI, or rules run on the full page) so a re-sync doesn't fall back to the snippet result.
    const keptVerdicts = new Map<string, { visa_requirement: string; visa_needs_review: boolean; visa_classified_by: string }>();
    const sourceIds = mappedJobs.map((job) => job.source_job_id);
    for (let i = 0; i < sourceIds.length; i += 100) {
      const { data: existing } = await supabase
        .from("jobs")
        .select("source_job_id,visa_requirement,visa_needs_review,visa_classified_by")
        .eq("source", ADZUNA_SOURCE)
        .or("visa_classified_by.eq.ai,full_text_status.eq.fetched")
        .in("source_job_id", sourceIds.slice(i, i + 100));
      for (const row of existing ?? []) {
        keptVerdicts.set(String(row.source_job_id), {
          visa_requirement: String(row.visa_requirement),
          visa_needs_review: Boolean(row.visa_needs_review),
          visa_classified_by: String(row.visa_classified_by ?? "rules"),
        });
      }
    }

    for (const job of mappedJobs) {
      const kept = keptVerdicts.get(job.source_job_id);
      if (kept) {
        Object.assign(job, kept);
      }
    }

    if (!mappedJobs.length) {
      await supabase
        .from("job_sync_runs")
        .update({
          status: "success",
          fetched_count: 0,
          upserted_count: 0,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);

      return NextResponse.json({
        syncedCount: 0,
        fetchedCount: 0,
        source: ADZUNA_SOURCE,
      });
    }

    const { data, error } = await supabase
      .from("jobs")
      .upsert(mappedJobs, { onConflict: "source,source_job_id" })
      .select("id,source,source_job_id,title,company_name");

    if (error) {
      throw new Error(error.message);
    }

    let fullText = { fetched: 0, failed: 0, restricted: 0, open: 0 };
    try {
      fullText = await runFullTextReview(serverEnv.FULL_TEXT_FETCH_PER_SYNC);
    } catch {
      // Page fetching is best-effort; unchecked jobs are retried on the next sync.
    }

    let aiReview = { reviewed: 0, failed: 0 };
    try {
      aiReview = await runAiVisaReview(serverEnv.AI_REVIEW_PER_SYNC);
    } catch {
      // The AI pass is best-effort; flagged jobs are retried on the next sync.
    }

    await supabase
      .from("job_sync_runs")
      .update({
        status: "success",
        fetched_count: mappedJobs.length,
        upserted_count: data?.length ?? 0,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return NextResponse.json({
      syncedCount: data?.length ?? 0,
      fetchedCount: mappedJobs.length,
      source: ADZUNA_SOURCE,
      visaAiReview: aiReview,
      visaFullText: fullText,
      searchErrors,
      jobs: data ?? [],
    });
  } catch (error) {
    await supabase
      .from("job_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : "Unknown sync error",
      })
      .eq("id", runId);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync jobs from Adzuna" },
      { status: 500 },
    );
  }
}

export { POST as GET };
