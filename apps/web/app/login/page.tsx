"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "../auth.module.css";

async function bootstrapProfile(userId: string, email: string) {
  await fetch("/api/user/profile/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId, email }),
  });
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Welcome back.");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("Logging in...");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setStatus(error.message);
      return;
    }

    if (data.user?.id && data.user.email) {
      await bootstrapProfile(data.user.id, data.user.email);
    }

    setStatus("Logged in. Opening dashboard...");
    router.push("/app");
    router.refresh();
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>Log In</p>
        <h1>Return to your job command center.</h1>
        <p className={styles.subtext}>We keep your preference profile and interactions ready to continue learning.</p>

        <form className={styles.form} onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Signing in..." : "Log in"}
          </button>
        </form>

        <p className={styles.status}>{status}</p>

        <p className={styles.meta}>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
