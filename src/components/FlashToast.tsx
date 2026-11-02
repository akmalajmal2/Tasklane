"use client";

import { useEffect } from "react";
import { useAppApi } from "@/store/app-store";

/** Shows a one-time toast after a redirect (e.g. "Password updated"), then tidies the URL. */
export function FlashToast({ text }: { text: string }) {
  const app = useAppApi();
  useEffect(() => {
    app.getState().toast({ text, tone: "success" });
    window.history.replaceState(null, "", window.location.pathname);
  }, [app, text]);
  return null;
}
