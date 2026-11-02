"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { acceptInvite, declineInvite } from "@/app/actions";
import { useApp, useAppApi } from "@/store/app-store";
import type { MyInvite } from "@/lib/types";
import { Spinner } from "@/components/common/ui";

export function InviteButtons({ token, compact = false, onDone }: { token: string; compact?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const app = useAppApi();
  const [pending, start] = useTransition();
  const cls = compact ? "btn sm" : "btn";

  /** Remove the invitation everywhere it is shown (Projects list, bell) and mark its notification read. */
  const settle = () => {
    const s = app.getState();
    s.dropInvite(token);
    s.markRead(s.notices.filter((n) => n.link === `/invite/${token}`).map((n) => n.id));
    onDone?.();
  };

  return (
    <div className="dlg-actions">
      <button
        className={`${cls} subtle`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await declineInvite(token);
            if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
            settle();
            if (path.startsWith("/invite/")) router.replace("/projects");
            router.refresh();
          })
        }
      >
        Decline
      </button>
      <button
        className={`${cls} primary`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInvite(token);
            if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
            settle();
            router.push(`/projects/${r.data.project_id}`);
          })
        }
      >
        {pending && <Spinner />} {compact ? "Accept" : "Accept invitation"}
      </button>
    </div>
  );
}

export function InviteRow({ invite }: { invite: MyInvite }) {
  return (
    <div className="invite-row">
      <div className="grow">
        <strong>
          {invite.inviter_name ?? "A manager"} invited you to {invite.project_name}
        </strong>
        <div style={{ color: "var(--ink-2)" }}>Join as {invite.role}. You become a member once you accept.</div>
      </div>
      <InviteButtons token={invite.token} compact />
    </div>
  );
}

/** Invitations waiting for the signed-in user. They live in the app store, which the realtime feed keeps current. */
export function InviteList() {
  const invites = useApp((s) => s.invites);
  if (!invites.length) return null;
  return (
    <section aria-label="Invitations" style={{ display: "grid", gap: 8, marginBottom: 24 }}>
      {invites.map((i) => (
        <InviteRow key={i.token} invite={i} />
      ))}
    </section>
  );
}
