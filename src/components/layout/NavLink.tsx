"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { navigateWithTransition } from "@/lib/nav";

/** A <Link> whose navigation is animated with a View Transition (falls back to a normal link). */
export function NavLink({
  kind = "page",
  dir = "forward",
  onClick,
  ...props
}: ComponentProps<typeof Link> & { kind?: "page" | "tab"; dir?: "forward" | "back" }) {
  const router = useRouter();
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const href = typeof props.href === "string" ? props.href : (props.href.pathname ?? "");
        if (!href.startsWith("/") || href === window.location.pathname + window.location.search) return;
        if (navigateWithTransition(router, href, kind, dir)) e.preventDefault();
      }}
    />
  );
}
