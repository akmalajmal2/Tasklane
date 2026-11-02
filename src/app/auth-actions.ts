"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  notice?: string;
}

const safeNext = (n: FormDataEntryValue | null) => {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/projects";
};

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: error.message };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const next = safeNext(form.get("next"));
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };

  // Step 2 of sign-up: a small JPEG taken in the browser. It must NOT go into the user metadata:
  // Supabase copies metadata into the session token AND the session cookie, so a ~10 KB photo made the
  // cookies larger than the server's header limit (HTTP 431 = blank page right after sign-up).
  // Instead it is saved through set_my_avatar once there is a session (below, or by AvatarSync).
  const avatar = String(form.get("avatar") ?? "");
  if (!avatar.startsWith("data:image/jpeg;base64,") || avatar.length > 60_000) {
    return { error: "Add a profile photo to finish creating your account." };
  }

  const { data, error } = await supabase.auth.signUp({
    email: String(form.get("email") ?? "").trim(),
    password,
    options: {
      data: { full_name: String(form.get("name") ?? "").trim() },
      emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };
  if (data.session) {
    await supabase.rpc("set_my_avatar", { p_avatar: avatar }); // best effort: the app can add it later in Settings
    redirect(next);
  }
  return { notice: "Check your inbox for a confirmation link. After confirming, you'll land right where you left off." };
}

const appBase = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Sends a reset link. The answer is the same whether or not the address has an account (no account probing). */
export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid e-mail address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appBase()}/auth/callback?next=${encodeURIComponent("/auth/reset")}`,
  });
  if (error && error.status === 429) return { error: "Too many requests. Wait a minute, then try again." };
  return { notice: "If that address has an account, a reset link is on its way. Open it in this same browser." };
}

/** Used on /auth/reset, for someone who arrived through the e-mailed link (or is signed in and wants a new password). */
export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "This reset link has expired. Request a new one from the sign-in page." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/projects?pw=1");
}
