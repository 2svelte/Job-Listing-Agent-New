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

export default function SignupPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Create your account to start training recommendations.");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("Creating account...");

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setBusy(false);
      setStatus(error.message);
      return;
    }

    if (data.user?.id && data.user.email) {
      await bootstrapProfile(data.user.id, data.user.email);
      setStatus("Account created. Taking you to your dashboard...");
      router.push("/app");
      router.refresh();
      return;
    }

    setBusy(false);
    setStatus("Account request submitted. Confirm your email and then log in.");
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>Sign Up</p>
        <h1>Build your personalized job feed.</h1>
        <p className={styles.subtext}>We start with your preferences and refine from your job interactions.</p>

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
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>

        <p className={styles.status}>{status}</p>

        <p className={styles.meta}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}
