import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetForm } from "@/components/auth/ResetForm";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

export default async function ResetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No session means the link was opened elsewhere, or it expired.
  if (!user) redirect("/login?error=link");
  return (
    <main className="auth">
      <section className="auth-form">
        <ResetForm email={user.email ?? ""} />
      </section>
      <aside className="auth-art" aria-hidden>
        <h2>Every card knows who has to act next.</h2>
      </aside>
    </main>
  );
}
