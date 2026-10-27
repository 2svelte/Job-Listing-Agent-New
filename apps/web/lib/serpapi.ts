export const GOOGLE_JOBS_SOURCE = "google_jobs";

const SERPAPI_URL = "https://serpapi.com/search.json";

type SerpApplyOption = { title?: string; link?: string };

type SerpJob = {
  job_id?: string;
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  apply_options?: SerpApplyOption[];
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    work_from_home?: boolean;
  };
};

type SerpResponse = {
  jobs_results?: SerpJob[];
  error?: string;
  serpapi_pagination?: { next_page_token?: string };
};

export type SerpJobRow = {
  source: string;
  source_job_id: string;
  source_url: string;
  title: string;
  company_name: string;
  description: string;
  location: string;
  remote_type: string;
  employment_type: string | null;
  salary_min: null;
  salary_max: null;
  currency: string;
  tags: string[];
  category: null;
  posted_at: string | null;
  last_synced_at: string;
  is_active: boolean;
};

// Google returns relative dates such as "3 days ago" or "12 hours ago".
const parsePostedAt = (value: string | undefined, now: Date) => {
  const match = value?.match(/(\d+)\s*(hour|day|week|month)/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!unit) {
    return null;
  }
  const unitMs: Record<string, number> = {
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
  };

  return new Date(now.getTime() - amount * (unitMs[unit.toLowerCase()] ?? 0)).toISOString();
};

export const normalizeSerpJob = (raw: SerpJob, syncedAt: string): SerpJobRow | null => {
  const options = raw.apply_options ?? [];
  const primary = options.find((o) => o.link && /seek|linkedin/i.test(o.title ?? "")) ?? options.find((o) => o.link);
  const url = primary?.link ?? raw.share_link;

  if (!raw.job_id || !raw.title || !url) {
    return null;
  }

  const description = raw.description ?? "";
  const location = raw.location ?? "Australia";
  const isRemote =
    raw.detected_extensions?.work_from_home === true || /remote|work from home/i.test(`${raw.title} ${location}`);

  return {
    source: GOOGLE_JOBS_SOURCE,
    source_job_id: raw.job_id,
    source_url: url,
    title: raw.title,
    company_name: raw.company_name ?? "Unknown company",
    description,
    location,
    remote_type: isRemote ? "remote" : /hybrid/i.test(description) ? "hybrid" : "onsite",
    employment_type: raw.detected_extensions?.schedule_type ?? null,
    salary_min: null,
    salary_max: null,
    currency: "AUD",
    tags: [raw.via?.replace(/^via\s+/i, ""), raw.detected_extensions?.schedule_type].filter((t): t is string => Boolean(t)),
    category: null,
    posted_at: parsePostedAt(raw.detected_extensions?.posted_at, new Date(syncedAt)),
    last_synced_at: syncedAt,
    is_active: true,
  };
};

export const fetchGoogleJobsPage = async (opts: {
  apiKey: string;
  query: string;
  location: string;
  nextPageToken?: string;
}) => {
  const params = new URLSearchParams({
    engine: "google_jobs",
    q: `${opts.query} ${opts.location}`,
    gl: "au",
    hl: "en",
    api_key: opts.apiKey,
  });

  if (opts.nextPageToken) {
    params.set("next_page_token", opts.nextPageToken);
  }

  const response = await fetch(`${SERPAPI_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const data = (await response.json().catch(() => ({}))) as SerpResponse;
  if (!response.ok || data.error) {
    // SerpApi reports "hasn't returned any results" as an error; treat as empty
    if (data.error && /hasn't returned any results/i.test(data.error)) {
      return { jobs: [] as SerpJob[], nextPageToken: null };
    }
    throw new Error(`SerpApi request failed (${response.status}): ${data.error ?? "unknown error"}`);
  }

  return {
    jobs: data.jobs_results ?? [],
    nextPageToken: data.serpapi_pagination?.next_page_token ?? null,
  };
};
