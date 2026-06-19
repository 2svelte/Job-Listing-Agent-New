import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";

const syncBodySchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
});

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string;
  candidate_required_location: string;
  salary: string;
  description: string;
  publication_date: string;
  tags: string[];
};

const parseSalaryRange = (rawSalary: string) => {
  const numbers = rawSalary.match(/\d+/g);
  if (!numbers?.length) {
    return { min: null, max: null };
  }

  if (numbers.length === 1) {
    const value = Number(numbers[0]);
    return Number.isFinite(value) ? { min: value, max: value } : { min: null, max: null };
  }

  const values = numbers.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: null, max: null };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
};

const mapRemoteType = (candidateLocation: string) => {
  const value = candidateLocation.toLowerCase();
  if (value.includes("remote")) {
    return "remote";
  }

  if (value.includes("hybrid")) {
    return "hybrid";
  }

  return "onsite";
};

export async function POST(request: NextRequest) {
  if (serverEnv.SYNC_ADMIN_SECRET) {
    const secret = request.headers.get("x-admin-secret");
    if (secret !== serverEnv.SYNC_ADMIN_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const parsed = syncBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const query = parsed.data.limit ? `?limit=${parsed.data.limit}` : "";
  const response = await fetch(`${REMOTIVE_API_URL}${query}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Remotive request failed with status ${response.status}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as { jobs?: RemotiveJob[] };
  const remotiveJobs = payload.jobs ?? [];
  const supabase = getSupabaseAdminClient();

  const mappedJobs = remotiveJobs.map((job) => {
    const salary = parseSalaryRange(job.salary);
    return {
      source: "remotive",
      source_job_id: String(job.id),
      source_url: job.url,
      title: job.title,
      company_name: job.company_name,
      description: job.description,
      location: job.candidate_required_location,
      remote_type: mapRemoteType(job.candidate_required_location),
      employment_type: job.job_type,
      salary_min: salary.min,
      salary_max: salary.max,
      currency: "USD",
      tags: job.tags,
      category: job.category,
      posted_at: job.publication_date,
      last_synced_at: new Date().toISOString(),
      is_active: true,
    };
  });

  const { data, error } = await supabase
    .from("jobs")
    .upsert(mappedJobs, { onConflict: "source,source_job_id" })
    .select("id,source,source_job_id,title,company_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    syncedCount: data?.length ?? 0,
    jobs: data ?? [],
  });
}
