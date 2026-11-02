"use client";

import { NavLink } from "@/components/layout/NavLink";
import { usePathname } from "next/navigation";
import { useApp } from "@/store/app-store";
import { Logo } from "@/components/layout/Logo";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/account/UserMenu";

export function TopBar() {
  const path = usePathname();
  const isAdmin = useApp((s) => s.me.is_admin);
  return (
    <header className="topbar">
      <NavLink href="/projects" className="brand" aria-label="Tasklane home">
        <Logo />
      </NavLink>
      <nav className="topnav" aria-label="Main">
        <NavLink href="/projects" aria-current={path.startsWith("/projects") ? "page" : undefined}>
          Projects
        </NavLink>
        {isAdmin && (
          <NavLink href="/admin" aria-current={path.startsWith("/admin") ? "page" : undefined}>
            Admin
          </NavLink>
        )}
      </nav>
      <ThemeToggle />
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
