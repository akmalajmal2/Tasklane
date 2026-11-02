"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "@/store/app-store";

/** Saves the sign-up photo that was kept in this browser while e-mail confirmation was pending. */
export function AvatarSync() {
  const email = useApp((s) => s.me.email);
  const has = useApp((s) => !!s.me.avatar_url);
  const setMe = useApp((s) => s.setMe);

  useEffect(() => {
    if (has) return;
    const key = `tl-avatar:${email.trim().toLowerCase()}`;
    let photo: string | null = null;
    try {
      photo = localStorage.getItem(key);
    } catch {
      return;
    }
    if (!photo) return;
    void createClient()
      .rpc("set_my_avatar", { p_avatar: photo })
      .then(({ data, error }) => {
        if (error) return;
        setMe({ avatar_url: (data as string | null) ?? photo });
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      });
  }, [email, has, setMe]);

  return null;
}
