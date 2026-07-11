import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/server-env";

const ADZUNA_API_BASE_URL = "https://api.adzuna.com/v1/api/jobs";
const ADZUNA_SOURCE = "adzuna";

const searchBodySchema = z.object({
  pages: z.number().int().positive().max(5).optional().default(1),
  what: z.string().min(1).max(120).optional(),
  whatExclude: z.string().min(1).max(120).optional(),
  where: z.string().min(1).max(120).optional(),
  sortBy: z.enum(["salary", "date", "relevance"]).optional(),
  salaryMin: z.number().int().nonnegative().optional(),
  fullTime: z.boolean().optional(),
  permanent: z.boolean().optional(),
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
  const parsed = searchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { pages, what, whatExclude, where, sortBy, salaryMin, fullTime, permanent } = parsed.data;

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

    const jobs = adzunaJobs.map((job) => {
      const sourceJobId = String(job.id);
      const location = job.location?.display_name ?? null;
      const description = job.description ?? "";
      const title = job.title ?? "Untitled role";

      return {
        id: `${ADZUNA_SOURCE}:${sourceJobId}`,
        source: ADZUNA_SOURCE,
        source_job_id: sourceJobId,
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
      };
    });

    return NextResponse.json({
      source: ADZUNA_SOURCE,
      fetchedCount: jobs.length,
      jobs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch jobs from Adzuna" },
      { status: 500 },
    );
  }
}
