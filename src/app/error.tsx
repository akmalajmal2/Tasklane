"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page" style={{ maxWidth: 520, textAlign: "center", paddingTop: 96 }}>
      <h1>Something went wrong</h1>
      <p style={{ color: "var(--ink-2)", margin: "8px 0 20px" }}>An unexpected error occurred. Try again, or reload the page.</p>
      <button className="btn primary" onClick={reset}>Try again</button>
    </main>
  );
}
