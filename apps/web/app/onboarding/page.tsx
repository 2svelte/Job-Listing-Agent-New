"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SessionUser = {
  id: string;
  email?: string;
};

type JobSummary = {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  source_url: string;
};

const bootstrapProfile = async (user: SessionUser) => {
  if (!user.email) {
    return;
  }

  await fetch("/api/user/profile/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: user.id,
      email: user.email,
    }),
  });
};

const splitInput = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function OnboardingPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState("Idle");

  const [titleInput, setTitleInput] = useState("Software Engineer, Backend Engineer");
  const [locationInput, setLocationInput] = useState("Remote, New York");
  const [tagInput, setTagInput] = useState("TypeScript, Node.js, PostgreSQL");
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      if (sessionUser) {
        const nextUser = { id: sessionUser.id, email: sessionUser.email };
        setUser(nextUser);
        bootstrapProfile(nextUser).catch(() => {
          setStatus("Unable to bootstrap profile automatically.");
        });
      }
    });
  }, [supabase]);

  const signUp = async () => {
    setStatus("Creating account...");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setStatus(`Sign up failed: ${error.message}`);
      return;
    }

    const sessionUser = data.user;
    if (sessionUser) {
      const nextUser = { id: sessionUser.id, email: sessionUser.email };
      setUser(nextUser);
      await bootstrapProfile(nextUser);
      setStatus("Account created. If email confirmation is enabled, check your inbox.");
      return;
    }

    setStatus("Sign up submitted. Check your email to confirm account.");
  };

  const signIn = async () => {
    setStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(`Sign in failed: ${error.message}`);
      return;
    }

    const sessionUser = data.user;
    if (!sessionUser) {
      setStatus("No user session returned.");
      return;
    }

    const nextUser = { id: sessionUser.id, email: sessionUser.email };
    setUser(nextUser);
    await bootstrapProfile(nextUser);
    setStatus("Signed in.");
  };

  const savePreferences = async () => {
    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    const response = await fetch(`/api/user/preferences?userId=${user.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preferredTitles: splitInput(titleInput),
        preferredJobTypes: ["Full-time"],
        preferredLocations: splitInput(locationInput),
        preferredRemoteTypes: ["remote", "hybrid"],
        minSalary: 90000,
        maxSalary: 250000,
        preferredTags: splitInput(tagInput),
      }),
    });

    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatus(`Saving preferences failed: ${payload.error ?? "unknown error"}`);
      return;
    }

    setStatus("Preferences saved.");
  };

  const loadRecommendations = async () => {
    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    setStatus("Loading recommendations...");
    const response = await fetch(`/api/recommendations?userId=${user.id}&limit=8`);
    const payload = (await response.json()) as {
      error?: string;
      recommendations?: { job: JobSummary }[];
    };

    if (!response.ok) {
      setStatus(`Failed to load recommendations: ${payload.error ?? "unknown error"}`);
      return;
    }

    setJobs((payload.recommendations ?? []).map((item) => item.job));
    setStatus("Recommendations loaded.");
  };

  const interact = async (jobId: string, interactionType: "saved" | "liked" | "disliked" | "applied") => {
    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    const response = await fetch(`/api/jobs/${jobId}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: user.id,
        interactionType,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatus(`Failed to ${interactionType}: ${payload.error ?? "unknown error"}`);
      return;
    }

    setStatus(`Recorded interaction: ${interactionType}. Refreshing recommendations...`);
    await loadRecommendations();
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px 72px" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Auth + Onboarding + Interactions</h1>
      <p style={{ marginBottom: 24, lineHeight: 1.6 }}>
        This page bootstraps account sign-in, preference capture, and direct save/like/dislike/apply interactions.
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 12px" }}>1) Account</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={signUp}>Sign up</button>
            <button onClick={signIn}>Sign in</button>
          </div>
          <div>
            Current user: {user ? `${user.email ?? "(no email)"} (${user.id})` : "none"}
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 12px" }}>2) Preferences</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <label>
            Titles (comma-separated)
            <input
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>
          <label>
            Locations (comma-separated)
            <input
              value={locationInput}
              onChange={(event) => setLocationInput(event.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>
          <label>
            Skill tags (comma-separated)
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={savePreferences}>Save preferences</button>
            <button onClick={loadRecommendations}>Load recommendations</button>
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 12px" }}>3) Recommended Jobs</h2>
        {jobs.length === 0 ? (
          <p>No jobs loaded yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {jobs.map((job) => (
              <article key={job.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                <h3 style={{ margin: "0 0 4px" }}>{job.title}</h3>
                <div style={{ marginBottom: 8 }}>
                  {job.company_name} {job.location ? `· ${job.location}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => interact(job.id, "saved")}>Save</button>
                  <button onClick={() => interact(job.id, "liked")}>Like</button>
                  <button onClick={() => interact(job.id, "disliked")}>Dislike</button>
                  <button onClick={() => interact(job.id, "applied")}>Applied</button>
                  <a href={job.source_url} target="_blank" rel="noreferrer">
                    Open job
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p>Status: {status}</p>
    </main>
  );
}
