export type AtsProvider = "greenhouse" | "lever" | "ashby";

export const ATS_PROVIDERS: AtsProvider[] = ["greenhouse", "lever", "ashby"];

export type UnifiedJob = {
  sourceId: string;
  source: AtsProvider;
  company: string;
  title: string;
  location: string;
  isRemote: boolean;
  descriptionHtml: string;
  applyUrl: string;
  publishedAt?: string;
  employmentType?: string;
  category?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
};

export class AtsNotFoundError extends Error {
  constructor(provider: AtsProvider, token: string) {
    super(`${provider} board "${token}" not found (404)`);
    this.name = "AtsNotFoundError";
  }
}

const USER_AGENT = "JobListingAgentBot/1.0";
const REQUEST_TIMEOUT_MS = 20_000;

const getJson = async (provider: AtsProvider, token: string, url: string) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    throw new AtsNotFoundError(provider, token);
  }

  if (!response.ok) {
    throw new Error(`${provider} request for "${token}" failed with status ${response.status}`);
  }

  return (await response.json()) as unknown;
};

const toIso = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const mentionsRemote = (value?: string | null) => Boolean(value && value.toLowerCase().includes("remote"));

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchGreenhouseJobs(token: string, company: string): Promise<UnifiedJob[]> {
  const data: any = await getJson(
    "greenhouse",
    token,
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  );

  return (data?.jobs ?? []).map((job: any): UnifiedJob => {
    const location = job.location?.name || "Unspecified";
    return {
      sourceId: String(job.id),
      source: "greenhouse",
      company,
      title: job.title ?? "Untitled role",
      location,
      isRemote: mentionsRemote(location),
      descriptionHtml: job.content ?? "",
      applyUrl: job.absolute_url,
      publishedAt: toIso(job.first_published ?? job.updated_at),
      category: job.departments?.[0]?.name,
    };
  });
}

export async function fetchLeverJobs(token: string, company: string): Promise<UnifiedJob[]> {
  const data: any = await getJson(
    "lever",
    token,
    `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
  );

  return (Array.isArray(data) ? data : []).map((job: any): UnifiedJob => {
    const location = job.categories?.location || "Unspecified";
    return {
      sourceId: String(job.id),
      source: "lever",
      company,
      title: job.text ?? "Untitled role",
      location,
      isRemote: job.workplaceType === "remote" || mentionsRemote(location),
      descriptionHtml: job.description ?? "",
      applyUrl: job.hostedUrl || job.applyUrl,
      publishedAt: toIso(job.createdAt),
      employmentType: job.categories?.commitment,
      category: job.categories?.team,
      salaryMin: Number.isFinite(job.salaryRange?.min) ? Math.round(job.salaryRange.min) : undefined,
      salaryMax: Number.isFinite(job.salaryRange?.max) ? Math.round(job.salaryRange.max) : undefined,
      currency: job.salaryRange?.currency,
    };
  });
}

export async function fetchAshbyJobs(token: string, company: string): Promise<UnifiedJob[]> {
  const data: any = await getJson(
    "ashby",
    token,
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
  );

  return (data?.jobs ?? [])
    .filter((job: any) => job.isListed !== false)
    .map((job: any): UnifiedJob => {
      const location = job.location || job.address?.postalAddress?.addressLocality || "Unspecified";
      const component = job.compensation?.summaryComponents?.find((c: any) => c.compensationType === "Salary");
      return {
        sourceId: String(job.id),
        source: "ashby",
        company,
        title: job.title ?? "Untitled role",
        location,
        isRemote: Boolean(job.isRemote) || String(job.workplaceType).toLowerCase() === "remote",
        descriptionHtml: job.descriptionHtml ?? "",
        applyUrl: job.applyUrl || job.jobUrl,
        publishedAt: toIso(job.publishedAt),
        employmentType: job.employmentType,
        category: job.department ?? job.team,
        salaryMin: Number.isFinite(component?.minValue) ? Math.round(component.minValue) : undefined,
        salaryMax: Number.isFinite(component?.maxValue) ? Math.round(component.maxValue) : undefined,
        currency: component?.currencyCode,
      };
    });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export const fetchAtsJobs = (provider: AtsProvider, token: string, company: string) => {
  switch (provider) {
    case "greenhouse":
      return fetchGreenhouseJobs(token, company);
    case "lever":
      return fetchLeverJobs(token, company);
    case "ashby":
      return fetchAshbyJobs(token, company);
  }
};

const ATS_URL_PATTERNS: Array<{ provider: AtsProvider; pattern: RegExp }> = [
  { provider: "greenhouse", pattern: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { provider: "lever", pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/i },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i },
];

export const parseAtsUrl = (url?: string | null): { provider: AtsProvider; token: string } | null => {
  if (!url) {
    return null;
  }

  for (const { provider, pattern } of ATS_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return { provider, token: decodeURIComponent(match[1]).toLowerCase() };
    }
  }

  return null;
};

export const toJobRow = (job: UnifiedJob, syncedAt: string) => ({
  source: job.source,
  source_job_id: job.sourceId,
  source_url: job.applyUrl,
  title: job.title,
  company_name: job.company,
  description: job.descriptionHtml,
  location: job.location,
  remote_type: job.isRemote || mentionsRemote(job.title) ? "remote" : "onsite",
  employment_type: job.employmentType ?? null,
  salary_min: job.salaryMin ?? null,
  salary_max: job.salaryMax ?? null,
  currency: job.currency ?? "USD",
  tags: [job.category, job.employmentType].filter((tag): tag is string => Boolean(tag)),
  category: job.category ?? null,
  posted_at: job.publishedAt ?? null,
  last_synced_at: syncedAt,
  is_active: true,
});
