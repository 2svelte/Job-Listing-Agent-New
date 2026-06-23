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
};

type Recommendation = {
  score: number;
  reasons: string[];
  job: Job;
};

type PreferencesResponse = {
  preferences: {
    preferred_titles: string[];
    preferred_locations: string[];
    preferred_tags: string[];
  } | null;
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

  const [titleInput, setTitleInput] = useState("Software Engineer, Backend Engineer");
  const [locationInput, setLocationInput] = useState("Remote");
  const [tagInput, setTagInput] = useState("TypeScript, Node.js, PostgreSQL");

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
    };

    void init();
  }, [supabase]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const loadExistingPreferences = async () => {
      const response = await fetch(`/api/user/preferences?userId=${userId}`);
      const payload = await parseApiPayload<PreferencesResponse>(response);
      if (!response.ok || !payload.preferences) {
        return;
      }

      if (payload.preferences.preferred_titles?.length) {
        setTitleInput(payload.preferences.preferred_titles.join(", "));
      }

      if (payload.preferences.preferred_locations?.length) {
        setLocationInput(payload.preferences.preferred_locations.join(", "));
      }

      if (payload.preferences.preferred_tags?.length) {
        setTagInput(payload.preferences.preferred_tags.join(", "));
      }
    };

    void loadExistingPreferences();
  }, [userId]);

  const splitInput = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

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
      }),
    });

    const prefPayload = await parseApiPayload<{ error?: string }>(response);
    if (!response.ok) {
      setSearchBusy(false);
      setStatus(prefPayload.error ?? "Failed to save preferences.");
      return;
    }

    // Then, search for jobs matching the preferences
    setStatus("Searching for jobs...");

    const titles = splitInput(titleInput).join(", ");
    const locations = splitInput(locationInput).join(", ");

    const syncResponse = await fetch("/api/admin/jobs/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pages: 2,
        what: titles || undefined,
        where: locations || undefined,
      }),
    });

    type SyncResult = {
      skipped?: boolean;
      reason?: string;
      syncedCount?: number;
      fetchedCount?: number;
      error?: string;
    };

    const syncResult = await parseApiPayload<SyncResult>(syncResponse);
    if (!syncResponse.ok) {
      setSearchBusy(false);
      setStatus(syncResult.error ?? "Failed to search for jobs.");
      return;
    }

    if (syncResult.skipped) {
      setStatus(syncResult.reason ?? "Search skipped.");
    } else {
      setStatus(`Found ${syncResult.fetchedCount ?? 0} jobs.`);
    }

    setSearchBusy(false);
    await loadRecommendations();
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
        <button disabled={searchBusy} onClick={searchJobs}>
          {searchBusy ? "Searching..." : "Search Jobs"}
        </button>
      </section>

      <section className={styles.results}>
        <h2>Recommended Jobs</h2>
        <p className={styles.attribution}>
          Jobs by <a href="https://www.adzuna.com.au" target="_blank" rel="noreferrer">Adzuna</a>
        </p>
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
                <p className={styles.score}>Match score: {(item.score * 100).toFixed(1)}%</p>
                <ul>
                  {item.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className={styles.cardActions}>
                  <button onClick={() => addInteraction(item.job.id, "saved")}>Save</button>
                  <button onClick={() => addInteraction(item.job.id, "liked")}>Like</button>
                  <button onClick={() => addInteraction(item.job.id, "disliked")}>Dislike</button>
                  <button onClick={() => addInteraction(item.job.id, "applied")}>Applied</button>
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
