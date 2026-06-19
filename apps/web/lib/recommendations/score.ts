export type JobRecord = {
  id: string;
  title: string | null;
  location: string | null;
  remote_type: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  is_active: boolean | null;
  tags: string[] | null;
  posted_at: string | null;
};

export type PreferenceRecord = {
  preferred_titles: string[] | null;
  preferred_job_types: string[] | null;
  preferred_locations: string[] | null;
  preferred_remote_types: string[] | null;
  min_salary: number | null;
  max_salary: number | null;
  preferred_tags: string[] | null;
};

export type InteractionRecord = {
  job_id: string;
  interaction_type: "saved" | "applied" | "liked" | "disliked" | "viewed";
  created_at: string;
};

type ScoredJob = {
  jobId: string;
  score: number;
  reasons: string[];
};

const normalize = (value: string) => value.toLowerCase().trim();

const intersects = (a: string[] | null | undefined, b: string[] | null | undefined) => {
  if (!a?.length || !b?.length) {
    return false;
  }

  const right = new Set(b.map(normalize));
  return a.some((item) => right.has(normalize(item)));
};

const wasRecentlyInteracted = (
  interactions: InteractionRecord[],
  jobId: string,
  type: InteractionRecord["interaction_type"],
) => {
  const now = Date.now();
  const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;

  return interactions.some((interaction) => {
    if (interaction.job_id !== jobId || interaction.interaction_type !== type) {
      return false;
    }

    const timestamp = new Date(interaction.created_at).getTime();
    return Number.isFinite(timestamp) && now - timestamp < thirtyDaysMs;
  });
};

export const scoreJobs = (
  jobs: JobRecord[],
  preferences: PreferenceRecord | null,
  interactions: InteractionRecord[],
) => {
  const scored: ScoredJob[] = [];

  for (const job of jobs) {
    if (!job.is_active) {
      continue;
    }

    let score = 0.2;
    const reasons: string[] = [];

    if (preferences) {
      if (
        preferences.preferred_titles?.length &&
        job.title &&
        preferences.preferred_titles.some((title) =>
          job.title?.toLowerCase().includes(title.toLowerCase()),
        )
      ) {
        score += 0.2;
        reasons.push("Title aligns with your preferences");
      }

      if (
        preferences.preferred_locations?.length &&
        job.location &&
        preferences.preferred_locations.some((location) =>
          job.location?.toLowerCase().includes(location.toLowerCase()),
        )
      ) {
        score += 0.15;
        reasons.push("Location match");
      }

      if (
        preferences.preferred_remote_types?.length &&
        job.remote_type &&
        preferences.preferred_remote_types.includes(job.remote_type)
      ) {
        score += 0.15;
        reasons.push("Remote preference match");
      }

      if (
        preferences.preferred_job_types?.length &&
        job.employment_type &&
        preferences.preferred_job_types.includes(job.employment_type)
      ) {
        score += 0.1;
        reasons.push("Job type match");
      }

      if (intersects(preferences.preferred_tags, job.tags)) {
        score += 0.1;
        reasons.push("Skills/tag overlap");
      }

      if (preferences.min_salary && job.salary_max && job.salary_max >= preferences.min_salary) {
        score += 0.08;
        reasons.push("Meets minimum salary target");
      }

      if (preferences.max_salary && job.salary_min && job.salary_min <= preferences.max_salary) {
        score += 0.07;
      }
    }

    if (wasRecentlyInteracted(interactions, job.id, "liked")) {
      score += 0.2;
      reasons.push("You liked similar listings");
    }

    if (wasRecentlyInteracted(interactions, job.id, "saved")) {
      score += 0.12;
      reasons.push("Similar to your saved jobs");
    }

    if (wasRecentlyInteracted(interactions, job.id, "applied")) {
      score += 0.15;
      reasons.push("Similar to roles you applied to");
    }

    if (wasRecentlyInteracted(interactions, job.id, "disliked")) {
      score -= 0.35;
      reasons.push("Deprioritized from your dislikes");
    }

    score = Math.max(0, Math.min(1, score));

    scored.push({
      jobId: job.id,
      score,
      reasons,
    });
  }

  return scored.sort((a, b) => b.score - a.score);
};
