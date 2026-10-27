"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "../dashboard.module.css";

type Job = {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  source_url: string;
  visa_requirement?: string | null;
};

type Recommendation = {
  score: number;
  reasons: string[];
  job: Job;
};

type LiveSearchJob = {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  source_url: string;
  visa_requirement?: string | null;
};

const parseApiPayload = async <T extends object>(
  response: Response,
): Promise<Partial<T> & { error?: string }> => {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Partial<T> & { error?: string };
  } catch {
    return { error: text.slice(0, 200) } as Partial<T> & { error?: string };
  }
};

export default function AppHomePage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [loadingSession, setLoadingSession] = useState(true);
  const [status, setStatus] = useState("Loading session...");

  const [titleInput, setTitleInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [excludeVisaRestricted, setExcludeVisaRestricted] = useState(false);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        setLoadingSession(false);
        setStatus("Please log in to access your dashboard.");
        return;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");
      setLoadingSession(false);
      setStatus("Session loaded.");

      const prefResponse = await fetch(`/api/user/preferences?userId=${user.id}`);
      const prefPayload = await parseApiPayload<{ preferences?: { exclude_visa_restricted?: boolean } | null }>(
        prefResponse,
      );
      if (prefResponse.ok && prefPayload.preferences?.exclude_visa_restricted) {
        setExcludeVisaRestricted(true);
      }
    };

    void init();
  }, [supabase]);

  const splitInput = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const loadRecommendations = async () => {
    if (!userId) {
      return;
    }

    setStatus("Refreshing recommendations...");
    const response = await fetch(`/api/recommendations?userId=${userId}&limit=12`);
    const payload = await parseApiPayload<{
      recommendations?: Recommendation[];
      error?: string;
    }>(response);

    if (!response.ok) {
      setStatus(payload.error ?? "Unable to load recommendations.");
      return;
    }

    setRecommendations(payload.recommendations ?? []);
    setStatus(`Loaded ${payload.recommendations?.length ?? 0} recommendation(s).`);
  };

  const addInteraction = async (jobId: string, interactionType: "saved" | "liked" | "disliked" | "applied") => {
    if (!userId) {
      return;
    }

    const response = await fetch(`/api/jobs/${jobId}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        interactionType,
      }),
    });

    const payload = await parseApiPayload<{ error?: string }>(response);
    if (!response.ok) {
      setStatus(payload.error ?? "Failed to save interaction.");
      return;
    }

    setStatus(`Recorded ${interactionType}.`);
    await loadRecommendations();
  };

  const searchJobs = async () => {
    setSearchBusy(true);
    setStatus("Saving preferences and searching for jobs...");

    // First, save preferences
    const response = await fetch(`/api/user/preferences?userId=${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preferredTitles: splitInput(titleInput),
        preferredJobTypes: ["Full-time"],
        preferredLocations: splitInput(locationInput),
        preferredRemoteTypes: ["remote", "hybrid", "onsite"],
        minSalary: 80000,
        maxSalary: 300000,
        preferredTags: splitInput(tagInput),
        excludeVisaRestricted,
      }),
    });

    const prefPayload = await parseApiPayload<{ error?: string }>(response);
    if (!response.ok) {
      setSearchBusy(false);
      setStatus(prefPayload.error ?? "Failed to save preferences.");
      return;
    }

    // Then, fetch live jobs from Adzuna without bulk DB upsert
    setStatus("Searching live jobs...");

    const titles = splitInput(titleInput).join(", ");
    const locations = splitInput(locationInput).join(", ");

    const syncResponse = await fetch("/api/jobs/live-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pages: 2,
        what: titles || undefined,
        where: locations || undefined,
        excludeVisaRestricted,
      }),
    });

    type SyncResult = {
      fetchedCount?: number;
      jobs?: LiveSearchJob[];
      error?: string;
    };

    const syncResult = await parseApiPayload<SyncResult>(syncResponse);
    if (!syncResponse.ok) {
      setSearchBusy(false);
      setStatus(syncResult.error ?? "Failed to search for jobs.");
      return;
    }

    const liveRecommendations: Recommendation[] = (syncResult.jobs ?? []).map((job) => ({
      score: 0.5,
      reasons: ["Live result from your current search"],
      job: {
        id: job.id,
        title: job.title,
        company_name: job.company_name,
        location: job.location,
        source_url: job.source_url,
        visa_requirement: job.visa_requirement,
      },
    }));

    setRecommendations(liveRecommendations);
    setStatus(`Found ${syncResult.fetchedCount ?? 0} live jobs.`);

    setSearchBusy(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  if (loadingSession) {
    return (
      <main className={styles.page}>
        <p>Loading your dashboard...</p>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyState}>
          <h1>Your app home is ready.</h1>
          <p>{status}</p>
          <div className={styles.navActions}>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Create account</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Dashboard</p>
          <h1>Welcome{email ? `, ${email}` : ""}</h1>
          <p>{status}</p>
        </div>
        <div className={styles.headerButtons}>
          <button onClick={loadRecommendations}>Refresh feed</button>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className={styles.preferences}>
        <h2>Preference Inputs</h2>
        <div className={styles.prefGrid}>
          <label>
            Job titles
            <input value={titleInput} onChange={(event) => setTitleInput(event.target.value)} />
          </label>
          <label>
            Locations
            <input value={locationInput} onChange={(event) => setLocationInput(event.target.value)} />
          </label>
          <label>
            Skills/tags
            <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} />
          </label>
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={excludeVisaRestricted}
            onChange={(event) => setExcludeVisaRestricted(event.target.checked)}
          />
          Remove permanent visa / citizenship requirement
        </label>
        <button disabled={searchBusy} onClick={searchJobs}>
          {searchBusy ? "Searching..." : "Search Jobs"}
        </button>
      </section>

      <section className={styles.results}>
        <h2>Recommended Jobs</h2>
        {recommendations.length === 0 ? (
          <p>No recommendations yet. Save preferences or trigger job sync.</p>
        ) : (
          <div className={styles.cards}>
            {recommendations.map((item) => (
              <article className={styles.card} key={item.job.id}>
                <h3>{item.job.title}</h3>
                <p className={styles.cardMeta}>
                  {item.job.company_name}
                  {item.job.location ? ` · ${item.job.location}` : ""}
                </p>
                {item.job.visa_requirement === "restricted" ? (
                  <p className={styles.visaTag}>PR / citizens only</p>
                ) : null}
                <p className={styles.score}>Match score: {(item.score * 100).toFixed(1)}%</p>
                <ul>
                  {item.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className={styles.cardActions}>
                  <button disabled={!isUuid(item.job.id)} onClick={() => addInteraction(item.job.id, "saved")}>Save</button>
                  <button disabled={!isUuid(item.job.id)} onClick={() => addInteraction(item.job.id, "liked")}>Like</button>
                  <button disabled={!isUuid(item.job.id)} onClick={() => addInteraction(item.job.id, "disliked")}>Dislike</button>
                  <button disabled={!isUuid(item.job.id)} onClick={() => addInteraction(item.job.id, "applied")}>Applied</button>
                  <a href={item.job.source_url} rel="noreferrer" target="_blank">
                    Apply now
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
