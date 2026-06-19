export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Job Listing Agent</h1>
      <p style={{ marginBottom: 24, lineHeight: 1.6 }}>
        Backend foundation is active. Next steps are Supabase migration apply, auth onboarding UI, and interaction tracking UI.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: 10 }}>Implemented API Routes</h2>
        <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
          <li>GET /api/jobs</li>
          <li>GET /api/user/preferences?userId=&lt;uuid&gt;</li>
          <li>PUT /api/user/preferences?userId=&lt;uuid&gt;</li>
          <li>GET /api/recommendations?userId=&lt;uuid&gt;</li>
          <li>POST /api/admin/jobs/sync</li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: "1.25rem", marginBottom: 10 }}>Setup Checklist</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Copy apps/web/.env.example to apps/web/.env.local and fill in Supabase keys.</li>
          <li>Apply SQL migration in supabase/migrations/20260619_001_initial_job_listing_schema.sql.</li>
          <li>Start the app and trigger POST /api/admin/jobs/sync to ingest initial jobs.</li>
        </ol>
      </section>
    </main>
  );
}
