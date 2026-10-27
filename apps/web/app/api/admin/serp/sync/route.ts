import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminRequest } from "@/lib/admin-auth";
import { serverEnv } from "@/lib/server-env";
import { GOOGLE_JOBS_SOURCE, fetchGoogleJobsPage, normalizeSerpJob, type SerpJobRow } from "@/lib/serpapi";

export const maxDuration = 300;

const bodySchema = z.object({
  queries: z.number().int().positive().max(10).optional().default(3),
  pagesPerQuery: z.number().int().positive().max(3).optional().default(1),
});

type QueryRow = { id: string; query: string; location: string };

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!serverEnv.SERPAPI_KEY) {
    return NextResponse.json({ error: "SerpApi is not configured. Set SERPAPI_KEY in apps/web/.env.local" }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { queries: queryCount, pagesPerQuery } = parsed.data;
  const supabase = getSupabaseAdminClient();

  // Every SerpApi call costs one search, so enforce the monthly quota from recorded runs.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: usageRows, error: usageError } = await supabase
    .from("job_sync_runs")
    .select("requested_pages")
    .eq("source", GOOGLE_JOBS_SOURCE)
    .gte("started_at", monthStart.toISOString());
  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  const used = (usageRows ?? []).reduce((sum, row) => sum + Number(row.requested_pages ?? 0), 0);
  const remaining = serverEnv.SERPAPI_MONTHLY_LIMIT - used;
  if (remaining <= 0) {
    return NextResponse.json({ skipped: true, reason: "Monthly SerpApi quota reached", used });
  }

  const { data: queryData, error: queryError } = await supabase
    .from("search_queries")
    .select("id,query,location")
    .eq("is_active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(queryCount);
  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const queries = (queryData ?? []) as unknown as QueryRow[];
  if (!queries.length) {
    return NextResponse.json({ skipped: true, reason: "No active search queries. POST to /api/admin/serp/queries" });
  }

  const { data: run, error: runError } = await supabase
    .from("job_sync_runs")
    .insert({ source: GOOGLE_JOBS_SOURCE, status: "started", requested_pages: 0, country: "au" })
    .select("id")
    .single();
  if (runError || !run?.id) {
    return NextResponse.json({ error: runError?.message ?? "Unable to create sync run" }, { status: 500 });
  }

  let apiCalls = 0;
  let upserted = 0;
  const perQuery: Array<{ query: string; location: string; fetched: number; error?: string }> = [];

  try {
    for (const q of queries) {
      const rows = new Map<string, SerpJobRow>();
      let token: string | undefined;
      let queryError: string | undefined;

      try {
        for (let page = 0; page < pagesPerQuery && apiCalls < remaining; page += 1) {
          apiCalls += 1;
          const result = await fetchGoogleJobsPage({
            apiKey: serverEnv.SERPAPI_KEY,
            query: q.query,
            location: q.location,
            nextPageToken: token,
          });

          const syncedAt = new Date().toISOString();
          for (const raw of result.jobs) {
            const row = normalizeSerpJob(raw, syncedAt);
            if (row) {
              rows.set(row.source_job_id, row);
            }
          }

          if (!result.nextPageToken) {
            break;
          }
          token = result.nextPageToken;
        }
      } catch (error) {
        queryError = error instanceof Error ? error.message : "Unknown error";
      }

      // source_url is unique across all sources, so skip URLs already owned by another record
      const byUrl = new Map<string, SerpJobRow>();
      for (const row of rows.values()) {
        byUrl.set(row.source_url, row);
      }

      const urls = Array.from(byUrl.keys());
      const taken = new Set<string>();
      for (let i = 0; i < urls.length; i += 100) {
        const { data } = await supabase
          .from("jobs")
          .select("source_url,source,source_job_id")
          .in("source_url", urls.slice(i, i + 100));
        for (const existing of data ?? []) {
          const row = byUrl.get(String(existing.source_url));
          if (row && !(existing.source === row.source && existing.source_job_id === row.source_job_id)) {
            taken.add(String(existing.source_url));
          }
        }
      }

      const toWrite = Array.from(byUrl.values()).filter((row) => !taken.has(row.source_url));
      if (toWrite.length) {
        const { data, error } = await supabase
          .from("jobs")
          .upsert(toWrite, { onConflict: "source,source_job_id" })
          .select("id");
        if (error) {
          throw new Error(error.message);
        }
        upserted += data?.length ?? 0;
      }

      if (!queryError) {
        await supabase.from("search_queries").update({ last_run_at: new Date().toISOString() }).eq("id", q.id);
      }

      perQuery.push({ query: q.query, location: q.location, fetched: toWrite.length, error: queryError });
    }

    await supabase
      .from("job_sync_runs")
      .update({
        status: "success",
        requested_pages: apiCalls,
        fetched_count: perQuery.reduce((sum, r) => sum + r.fetched, 0),
        upserted_count: upserted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return NextResponse.json({ apiCalls, upserted, quotaRemaining: remaining - apiCalls, results: perQuery });
  } catch (error) {
    await supabase
      .from("job_sync_runs")
      .update({
        status: "failed",
        requested_pages: apiCalls,
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : "Unknown sync error",
      })
      .eq("id", run.id);

    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}

export { POST as GET };
