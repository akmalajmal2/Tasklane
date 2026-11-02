import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Tasklane to manage your team's projects, reviews and testing in one place.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string; error?: string }> }) {
  const { next, email, error } = await searchParams;
  return (
    <main className="auth">
      <ThemeToggle floating />
      <section className="auth-form">
        <AuthForm next={next ?? "/projects"} email={email ?? ""} linkError={error === "link"} profileError={error === "profile"} />
      </section>
      <aside className="auth-art" aria-hidden>
        <h2>Every card knows who has to act next.</h2>
        <div className="mini-board">
          {["Proposed", "To do", "In review", "Completed"].map((c, i) => (
            <div className="mini-col" key={c}>
              <b>{c}</b>
              {i !== 0 && <div className="mini-card" />}
              {i === 0 && <div className="mini-card short" />}
              {i === 0 && <div className="mini-card" />}
              {i === 3 && <div className="mini-card short" />}
            </div>
          ))}
          <div className="mini-hero">MAF-24</div>
        </div>
      </aside>
    </main>
  );
}
