import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppProvider } from "@/store/app-store";
import { TopBar } from "@/components/layout/TopBar";
import { Toasts } from "@/components/common/Toasts";
import { ConfirmHost } from "@/components/common/ConfirmHost";
import { WorkTimer } from "@/components/timer/WorkTimer";
import { AvatarSync } from "@/components/account/AvatarSync";
import { NavSignal } from "@/lib/nav";
import type { MyInvite, Notice, Profile } from "@/lib/types";

import type { Metadata } from "next";

/** Signed-in pages are private: keep them out of search results. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: notices }, { data: invites }] = await Promise.all([
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.rpc("my_invites"),
  ]);

  // Try the full column list first, then older databases (no avatar_url / mute_email yet).
  const errors: string[] = [];
  const loadMe = async (): Promise<Profile | null> => {
    for (const cols of ["id,email,full_name,is_admin,mute_email,avatar_url", "id,email,full_name,is_admin,mute_email", "id,email,full_name,is_admin"]) {
      const { data, error } = await supabase.from("profiles").select(cols).eq("id", user.id).maybeSingle();
      if (data) return { mute_email: [], avatar_url: null, ...(data as unknown as Record<string, unknown>) } as unknown as Profile;
      if (error) errors.push(`select ${cols}: ${error.message}`);
    }
    return null;
  };
  let me = await loadMe();
  if (!me) {
    // Signed in but no profile row (account created before the trigger existed, DB reset...): create it now.
    const { error } = await supabase.rpc("ensure_my_profile");
    if (error) errors.push(`ensure_my_profile: ${error.message}`);
    else me = await loadMe();
  }
  if (!me) {
    return (
      <main className="page" style={{ maxWidth: 640, paddingTop: 72 }}>
        <h1>Your profile could not be loaded</h1>
        <p style={{ color: "var(--ink-2)", margin: "8px 0 14px" }}>
          You are signed in, but Tasklane could not read your profile from this Supabase project. Run <code>supabase/migrations/migration-v13-ensure-profile.sql</code> in the
          Supabase SQL Editor, check that <code>.env.local</code> points to the project where you ran the SQL, then sign in again.
        </p>
        {errors.length > 0 && (
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, padding: 12, border: "1px solid var(--line-strong)", borderRadius: 8, marginBottom: 16 }}>{errors.join("\n")}</pre>
        )}
        <a className="btn primary" href="/auth/signout">Sign out</a>
      </main>
    );
  }

  return (
    <AppProvider me={me} notices={(notices ?? []) as Notice[]} invites={(Array.isArray(invites) ? invites : []) as MyInvite[]}>
      <TopBar />
      <div className="route">{children}</div>
      <NavSignal />
      <Toasts />
      <ConfirmHost />
      <WorkTimer />
      <AvatarSync />
    </AppProvider>
  );
}
