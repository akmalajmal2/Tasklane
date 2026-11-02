"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePassword } from "@/app/auth-actions";
import { Logo } from "./Logo";
import { Spinner } from "./ui";

export function ResetForm({ email }: { email: string }) {
  const [state, action, busy] = useActionState(updatePassword, {});
  return (
    <div className="auth-card">
      <Logo />
      <div>
        <h1>Set a new password</h1>
        <p style={{ color: "var(--ink-2)", marginTop: 6 }}>For {email}</p>
      </div>
      <form action={action}>
        <label className="field">
          <span>New password</span>
          <input type="password" name="password" required minLength={8} autoComplete="new-password" autoFocus />
          <small>At least 8 characters.</small>
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" name="confirm" required minLength={8} autoComplete="new-password" />
        </label>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <button className="btn primary" style={{ height: 38 }} disabled={busy}>
          {busy && <Spinner />} Save password
        </button>
      </form>
      <p className="auth-switch"><Link href="/projects">Cancel</Link></p>
    </div>
  );
}
