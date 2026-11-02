"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAdmin } from "@/app/actions";
import { useAppApi } from "@/store/app-store";

export function AdminToggle({ userId, isAdmin, self }: { userId: string; isAdmin: boolean; self: boolean }) {
  const router = useRouter();
  const app = useAppApi();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn sm"
      disabled={pending}
      onClick={async () => {
        if (self) {
          const ok = await app.getState().ask({
            title: "Remove your own admin access?",
            body: "You will no longer see every project or manage workspace admins.",
            confirmLabel: "Remove access",
            tone: "danger",
          });
          if (!ok) return;
        }
        start(async () => {
          const r = await setAdmin(userId, !isAdmin);
          if (!r.ok) app.getState().toast({ text: r.error, tone: "danger" });
          router.refresh();
        });
      }}
    >
      {isAdmin ? "Remove admin" : "Make admin"}
    </button>
  );
}
