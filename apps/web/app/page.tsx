import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Smart Job Discovery</p>
        <h1>Find jobs that get sharper with every click.</h1>
        <p className={styles.description}>
          Start with your preferences, then let Job Listing Agent learn from what you save, like, dislike, and apply to.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/signup">
            Create account
          </Link>
          <Link className={styles.secondary} href="/login">
            Log in
          </Link>
          <Link className={styles.secondary} href="/app">
            Open app
          </Link>
        </div>
      </section>

      <section className={styles.grid}>
        <article>
          <h3>Set Preferences</h3>
          <p>Pick titles, locations, salary range, and skills to seed your first recommendation feed.</p>
        </article>
        <article>
          <h3>Train the Agent</h3>
          <p>Every save, like, dislike, and applied signal improves ranking and match confidence.</p>
        </article>
        <article>
          <h3>Discover Faster</h3>
          <p>Use one dashboard to review recommendations and jump to source listings in one click.</p>
        </article>
      </section>
    </main>
  );
}
