import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { InviteButtons } from "@/components/project/InviteActions";
import Link from "next/link";

export const metadata: Metadata = { title: "Invitation" };

interface InviteInfo {
  email: string;
  role: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  expired: boolean;
  project_id: string;
  project_name: string;
  inviter_name: string | null;
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isUuid = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = isUuid ? await supabase.rpc("get_invite", { p_token: token }) : { data: null };
  const inv = data as InviteInfo | null;

  let body: React.ReactNode;
  if (!inv) {
    body = <p>This invite link isn't valid. Ask a manager to send you a new one.</p>;
  } else if (inv.email.toLowerCase() !== (user?.email ?? "").toLowerCase()) {
    body = (
      <>
        <p>
          This invitation was sent to <strong>{inv.email}</strong>, but you're signed in as <strong>{user?.email}</strong>.
        </p>
        <form action={signOut}>
          <button className="btn primary">Sign out and switch account</button>
        </form>
      </>
    );
  } else if (inv.status === "accepted") {
    body = (
      <>
        <p>You're already a member of this project.</p>
        <Link className="btn primary" href={`/projects/${inv.project_id}`}>Open project</Link>
      </>
    );
  } else if (inv.status !== "pending") {
    body = <p>This invitation was {inv.status === "declined" ? "declined" : "cancelled"}. Ask a manager for a new one if you still need access.</p>;
  } else if (inv.expired) {
    body = <p>This invitation has expired. Ask a manager to send a new one.</p>;
  } else {
    body = (
      <>
        <p>
          {inv.inviter_name ?? "A manager"} invited you to join as <strong>{inv.role}</strong>. You'll only appear in the project, and only see its tasks, after you accept.
        </p>
        <InviteButtons token={token} />
      </>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 520 }}>
      <div style={{ display: "grid", gap: 16, padding: 24, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 650 }}>{inv ? `Join ${inv.project_name}` : "Invitation"}</h1>
        {body}
      </div>
    </main>
  );
}
