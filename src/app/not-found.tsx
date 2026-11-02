import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page" style={{ maxWidth: 520, textAlign: "center", paddingTop: 96 }}>
      <h1>Page not found</h1>
      <p style={{ color: "var(--ink-2)", margin: "8px 0 20px" }}>That page doesn't exist, or you don't have access to it.</p>
      <Link className="btn primary" href="/projects">Back to projects</Link>
    </main>
  );
}
