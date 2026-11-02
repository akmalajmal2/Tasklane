"use client";

import { useActionState, useEffect, useState } from "react";
import { requestPasswordReset, signIn, signUp } from "@/app/auth-actions";
import { Logo } from "./Logo";
import { PhotoCapture } from "./PhotoCapture";
import { Spinner } from "./ui";

export function AuthForm({ next, email, linkError, profileError = false }: { next: string; email: string; linkError: boolean; profileError?: boolean }) {
  const [mode, setMode] = useState<"in" | "up" | "forgot">(next.startsWith("/invite/") ? "up" : "in");
  const [inState, inAction, inBusy] = useActionState(signIn, {});
  const [upState, upAction, upBusy] = useActionState(signUp, {});
  const [fgState, fgAction, fgBusy] = useActionState(requestPasswordReset, {});
  const state = mode === "in" ? inState : mode === "up" ? upState : fgState;
  const busy = mode === "in" ? inBusy : mode === "up" ? upBusy : fgBusy;

  // Sign-up is two steps: 1) details, 2) profile photo. The details are kept in state so a server
  // error (which resets the form) never makes anyone type them again.
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [upEmail, setUpEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const up = mode === "up";

  // E-mail confirmation is on: there is no session yet, so keep the photo here until the first sign-in (see AvatarSync).
  useEffect(() => {
    if (up && upState.notice && photo) {
      try {
        localStorage.setItem(`tl-avatar:${upEmail.trim().toLowerCase()}`, photo);
      } catch {
        /* private mode: the photo can be added later in Settings */
      }
    }
  }, [up, upState.notice, photo, upEmail]);

  const switchMode = (m: "in" | "up" | "forgot") => {
    setMode(m);
    setStep(1);
  };

  return (
    <div className="auth-card">
      <Logo />
      <div>
        <h1>{mode === "in" ? "Sign in to Tasklane" : up ? (step === 1 ? "Create your account" : "Add your photo") : "Reset your password"}</h1>
        {up && <p className="step-label">Step {step} of 2</p>}
        {mode === "forgot" && <p style={{ color: "var(--ink-2)", marginTop: 6 }}>Enter your e-mail and we'll send you a link to choose a new password.</p>}
        {up && step === 2 && (
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>
            Your teammates see this photo next to your name. It is also the face Tasklane looks for while your task timer runs: the timer keeps going only while this person is at the camera. Face a camera in good light. Matching happens on your own computer; nothing is uploaded.
          </p>
        )}
        {next.startsWith("/invite/") && step === 1 && (
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>
            You've been invited to a project. {up ? "Create an account with the invited address to join." : "Sign in with the invited address to accept."}
          </p>
        )}
      </div>
      {linkError && <p className="form-error">That confirmation link has expired. Sign in or create the account again.</p>}
      {profileError && <p className="form-error">Your account has no profile in this database. Sign up again, or ask an admin to restore it.</p>}
      <form action={mode === "in" ? inAction : up ? upAction : fgAction} key={mode}>
        <input type="hidden" name="next" value={next} />
        {up && <input type="hidden" name="avatar" value={photo ?? ""} />}

        <div hidden={up && step === 2} className="step-fields">
          {up && (
            <label className="field">
              <span>Full name</span>
              <input type="text" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Work email</span>
            {up ? (
              <input type="email" name="email" required autoComplete="email" value={upEmail} onChange={(e) => setUpEmail(e.target.value)} />
            ) : (
              <input type="email" name="email" required autoComplete="email" defaultValue={email} />
            )}
          </label>
          {mode !== "forgot" && (
            <label className="field">
              <span>Password</span>
              {up ? (
                <input type="password" name="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              ) : (
                <input type="password" name="password" required autoComplete="current-password" />
              )}
              {up && <small>At least 8 characters.</small>}
              {mode === "in" && (
                <button type="button" className="link-btn" onClick={() => setMode("forgot")}>Forgot password?</button>
              )}
            </label>
          )}
        </div>

        {up && step === 2 && <PhotoCapture value={photo} onChange={setPhoto} />}

        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        {state.notice && <p className="chip" data-tone="ok" style={{ height: "auto", padding: "8px 10px", whiteSpace: "normal" }}>{state.notice}</p>}

        {up && step === 1 ? (
          <button
            type="button"
            className="btn primary"
            style={{ height: 38 }}
            onClick={(e) => {
              if (e.currentTarget.form?.reportValidity()) setStep(2);
            }}
          >
            Continue
          </button>
        ) : up ? (
          <div className="step-buttons">
            <button type="button" className="btn subtle" style={{ height: 38 }} onClick={() => setStep(1)} disabled={busy}>Back</button>
            <button className="btn primary" style={{ height: 38, flex: 1 }} disabled={busy || !photo}>
              {busy && <Spinner />} Create account
            </button>
          </div>
        ) : (
          <button className="btn primary" style={{ height: 38 }} disabled={busy}>
            {busy && <Spinner />} {mode === "in" ? "Sign in" : "Send reset link"}
          </button>
        )}
      </form>
      <p className="auth-switch">
        {mode === "in" ? "New here? " : up ? "Already have an account? " : "Remembered it? "}
        <button type="button" onClick={() => switchMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
