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

type SyncResponse = {
  skipped?: boolean;
  reason?: string;
  nextSyncAt?: string;
  syncedCount?: number;
  fetchedCount?: number;
  error?: string;
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
  const [syncStatus, setSyncStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncPages, setSyncPages] = useState("1");
  const [syncWhat, setSyncWhat] = useState("software engineer");
  const [syncWhere, setSyncWhere] = useState("sydney");
  const [syncSalaryMin, setSyncSalaryMin] = useState("90000");
  const [syncExclude, setSyncExclude] = useState("");
  const [syncAdminSecret, setSyncAdminSecret] = useState("");
  const [syncPermanent, setSyncPermanent] = useState(true);
  const [syncFullTime, setSyncFullTime] = useState(true);
  const [canSeeSyncPanel, setCanSeeSyncPanel] = useState(false);

  const syncPanelEnabled = process.env.NEXT_PUBLIC_ENABLE_SYNC_PANEL === "true";

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

      if (!syncPanelEnabled) {
        setCanSeeSyncPanel(false);
        return;
      }

      const accessToken = data.session?.access_token;
      const headers: HeadersInit = {};
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/user/sync-access", {
        method: "GET",
        headers,
      });

      const payload = await parseApiPayload<{ canAccessSyncPanel?: boolean }>(response);
      if (!response.ok) {
        setCanSeeSyncPanel(false);
        return;
      }

      setCanSeeSyncPanel(Boolean(payload.canAccessSyncPanel));
    };

    void init();
  }, [supabase, syncPanelEnabled]);

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

  const savePreferences = async () => {
    if (!userId) {
      return;
    }

    setStatus("Saving preferences...");
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

    const payload = await parseApiPayload<{ error?: string }>(response);
    if (!response.ok) {
      setStatus(payload.error ?? "Failed to save preferences.");
      return;
    }

    setStatus("Preferences saved.");
    await loadRecommendations();
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

  const runSync = async () => {
    setSyncBusy(true);
    setSyncStatus("Starting Adzuna sync...");

    const pagesNumber = Number(syncPages);
    const salaryMinNumber = Number(syncSalaryMin);
    const payload = {
      pages: Number.isFinite(pagesNumber) && pagesNumber > 0 ? pagesNumber : 1,
      what: syncWhat.trim() || undefined,
      whatExclude: syncExclude.trim() || undefined,
      where: syncWhere.trim() || undefined,
      salaryMin:
        Number.isFinite(salaryMinNumber) && salaryMinNumber > 0 ? salaryMinNumber : undefined,
      fullTime: syncFullTime,
      permanent: syncPermanent,
    };

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (syncAdminSecret.trim()) {
      headers["x-admin-secret"] = syncAdminSecret.trim();
    }

    const response = await fetch("/api/admin/jobs/sync", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const result = await parseApiPayload<SyncResponse>(response);
    if (!response.ok) {
      setSyncBusy(false);
      setSyncStatus(result.error ?? "Sync failed.");
      return;
    }

    if (result.skipped) {
      setSyncBusy(false);
      setSyncStatus(result.reason ?? "Sync skipped due to daily cache window.");
      return;
    }

    setSyncStatus(
      `Sync completed. Fetched ${result.fetchedCount ?? 0}, upserted ${result.syncedCount ?? 0}.`,
    );
    setSyncBusy(false);
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
        <button onClick={savePreferences}>Save and refresh recommendations</button>
      </section>

      {canSeeSyncPanel ? (
        <section className={styles.syncPanel}>
          <h2>Adzuna Sync Controls</h2>
          <p className={styles.syncHelp}>
            Admin/dev panel for ingestion only. This is separate from user preference matching.
          </p>
          <div className={styles.syncGrid}>
            <label>
              Pages (1-5)
              <input value={syncPages} onChange={(event) => setSyncPages(event.target.value)} />
            </label>
            <label>
              What
              <input value={syncWhat} onChange={(event) => setSyncWhat(event.target.value)} />
            </label>
            <label>
              Where
              <input value={syncWhere} onChange={(event) => setSyncWhere(event.target.value)} />
            </label>
            <label>
              Exclude keyword
              <input value={syncExclude} onChange={(event) => setSyncExclude(event.target.value)} />
            </label>
            <label>
              Salary min
              <input value={syncSalaryMin} onChange={(event) => setSyncSalaryMin(event.target.value)} />
            </label>
            <label>
              Admin secret (optional)
              <input
                type="password"
                value={syncAdminSecret}
                onChange={(event) => setSyncAdminSecret(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.syncToggles}>
            <label>
              <input
                type="checkbox"
                checked={syncFullTime}
                onChange={(event) => setSyncFullTime(event.target.checked)}
              />
              Full-time only
            </label>
            <label>
              <input
                type="checkbox"
                checked={syncPermanent}
                onChange={(event) => setSyncPermanent(event.target.checked)}
              />
              Permanent only
            </label>
          </div>

          <button disabled={syncBusy} onClick={runSync}>
            {syncBusy ? "Syncing..." : "Run Adzuna sync"}
          </button>
          <p className={styles.syncStatus}>{syncStatus}</p>
        </section>
      ) : null}

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
