import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminRequest } from "@/lib/admin-auth";
import { AtsNotFoundError, fetchAtsJobs, toJobRow, type AtsProvider } from "@/lib/ats";

export const maxDuration = 300;

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 5;
const UPSERT_CHUNK = 200;

const bodySchema = z.object({
  limit: z.number().int().positive().max(200).optional().default(100),
  force: z.boolean().optional().default(false),
  companyId: z.string().uuid().optional(),
});

type CompanyRow = {
  id: string;
  name: string;
  ats_provider: AtsProvider;
  board_token: string;
};

type CompanyResult = {
  company: string;
  provider: AtsProvider;
  status: "success" | "not_found" | "failed";
  fetched?: number;
  deactivated?: number;
  error?: string;
};

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { limit, force, companyId } = parsed.data;
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("tracked_companies")
    .select("id,name,ats_provider,board_token,last_synced_at")
    .eq("is_active", true)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (companyId) {
    query = query.eq("id", companyId);
  } else {
    query = query.eq("needs_verification", false);
    if (!force) {
      query = query.or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - STALE_AFTER_MS).toISOString()}`);
    }
  }

  const { data: companies, error: companiesError } = await query;
  if (companiesError) {
    return NextResponse.json({ error: companiesError.message }, { status: 500 });
  }

  const queue = [...((companies ?? []) as unknown as CompanyRow[])];
  const results: CompanyResult[] = [];

  const syncCompany = async (company: CompanyRow): Promise<CompanyResult> => {
    const base = { company: company.name, provider: company.ats_provider };
    try {
      const jobs = await fetchAtsJobs(company.ats_provider, company.board_token, company.name);
      const syncedAt = new Date().toISOString();

      const rows = new Map<string, ReturnType<typeof toJobRow>>();
      for (const job of jobs) {
        if (job.applyUrl) {
          rows.set(job.sourceId, toJobRow(job, syncedAt));
        }
      }

      const rowList = Array.from(rows.values());
      for (let i = 0; i < rowList.length; i += UPSERT_CHUNK) {
        const { error } = await supabase
          .from("jobs")
          .upsert(rowList.slice(i, i + UPSERT_CHUNK), { onConflict: "source,source_job_id" });
        if (error) {
          throw new Error(error.message);
        }
      }

      // Anything active for this company that is no longer listed has expired.
      const { data: activeRows, error: activeError } = await supabase
        .from("jobs")
        .select("id,source_job_id")
        .eq("source", company.ats_provider)
        .eq("company_name", company.name)
        .eq("is_active", true);
      if (activeError) {
        throw new Error(activeError.message);
      }

      const expiredIds = (activeRows ?? [])
        .filter((row) => !rows.has(String(row.source_job_id)))
        .map((row) => row.id as string);

      if (expiredIds.length) {
        const { error } = await supabase
          .from("jobs")
          .update({ is_active: false, updated_at: syncedAt })
          .in("id", expiredIds);
        if (error) {
          throw new Error(error.message);
        }
      }

      await supabase
        .from("tracked_companies")
        .update({ last_synced_at: syncedAt, last_error: null, needs_verification: false })
        .eq("id", company.id);

      return { ...base, status: "success", fetched: rowList.length, deactivated: expiredIds.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const notFound = error instanceof AtsNotFoundError;
      await supabase
        .from("tracked_companies")
        .update({ last_error: message, needs_verification: notFound ? true : undefined })
        .eq("id", company.id);
      return { ...base, status: notFound ? "not_found" : "failed", error: message };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let company = queue.shift(); company; company = queue.shift()) {
        results.push(await syncCompany(company));
      }
    }),
  );

  return NextResponse.json({
    companiesProcessed: results.length,
    succeeded: results.filter((r) => r.status === "success").length,
    flaggedForVerification: results.filter((r) => r.status === "not_found").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}

export { POST as GET };
