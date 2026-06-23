import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

const ADZUNA_API_BASE_URL = "https://api.adzuna.com/v1/api/jobs";
const ADZUNA_SOURCE = "adzuna";
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

const syncBodySchema = z.object({
  pages: z.number().int().positive().max(5).optional().default(1),
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

  const { pages, what, whatExclude, where, sortBy, salaryMin, fullTime, permanent, force } = parsed.data;

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

    for (let page = 1; page <= pages; page += 1) {
      const params = new URLSearchParams({
        app_id: serverEnv.ADZUNA_APP_ID,
        app_key: serverEnv.ADZUNA_APP_KEY,
        results_per_page: String(serverEnv.ADZUNA_RESULTS_PER_PAGE),
        "content-type": "application/json",
      });

      if (what) {
        params.set("what", what);
      }

      if (where) {
        params.set("where", where);
      }

      if (whatExclude) {
        params.set("what_exclude", whatExclude);
      }

      if (sortBy) {
        params.set("sort_by", sortBy);
      }

      if (typeof salaryMin === "number") {
        params.set("salary_min", String(salaryMin));
      }

      if (fullTime) {
        params.set("full_time", "1");
      }

      if (permanent) {
        params.set("permanent", "1");
      }

      const response = await fetch(
        `${ADZUNA_API_BASE_URL}/${serverEnv.ADZUNA_COUNTRY}/search/${page}?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(`Adzuna request failed (page ${page}) with status ${response.status}`);
      }

      const payload = (await response.json()) as AdzunaResponse;
      const pageJobs = payload.results ?? [];
      adzunaJobs.push(...pageJobs);

      if (!pageJobs.length) {
        break;
      }
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
      };
    });

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
