"use client";

import { useState } from "react";
import { signOut } from "@/app/actions";
import { useApp } from "@/store/app-store";
import { SettingsDialog } from "@/components/account/SettingsDialog";
import { Avatar, Icon } from "@/components/common/ui";

export function UserMenu() {
  const me = useApp((s) => s.me);
  const [settings, setSettings] = useState(false);
  return (
    <>
      <button className="icon-btn" popoverTarget="usermenu" aria-label="Account menu">
        <Avatar name={me.full_name || me.email} size={28} src={me.avatar_url} />
      </button>
      <div id="usermenu" popover="auto" className="pop pop-user">
        <div className="who">
          <strong>{me.full_name}</strong>
          <span>{me.email}</span>
          {me.is_admin && <em className="chip" data-tone="violet">Workspace admin</em>}
        </div>
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
            setSettings(true);
          }}
        >
          <Icon n="user" /> Account settings
        </button>
        <form action={signOut}>
          <button className="menu-item" type="submit">
            <Icon n="logout" /> Sign out
          </button>
        </form>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}
