# Tasklane

Jira-style project and task management: Kanban board, manager-approved task intake, role-based workflow, e-mail invitations, live updates, light/dark theme.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Realtime).
No UI component library and no state library (a 30-line store on React's `useSyncExternalStore`). Dialogs, drawers and menus use native `<dialog>` and the Popover API; motion is CSS (`@starting-style`, keyframes).

## Setup

1. `npm install`
2. Create a Supabase project, open **SQL Editor**, paste and run `supabase/schema.sql` (once, on a fresh project).
   *Upgrading an existing database?* See `supabase/README.md`. **If your database was made before v17, run `supabase/migrations/migration-v17-private-tasks.sql` once: that is what makes people see only their own tasks.**
3. Supabase → **Authentication → URL Configuration**: set *Site URL* to your app URL and add `http://localhost:3000/auth/callback` (and your production URL) to *Redirect URLs*.
4. Supabase → **Authentication → SMTP**: add your SMTP so confirmation e-mails are not rate-limited.
5. Copy `.env.example` to `.env.local` and fill it in. Without `RESEND_API_KEY`, notification e-mails are printed to the server log instead of sent.
6. `npm run dev`. **The first account you create becomes the workspace admin.**

Deploy on Vercel: add the same env vars. `vercel.json` already schedules `/api/cron/overdue` hourly (it needs `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`).

## Who sees which task

The database decides this (row-level security), so the board, task history, comments, attached files, live updates and work timers all follow the same rule.

| | Sees |
|---|---|
| **Manager** (and a workspace admin on projects they have not joined) | every task and every timer |
| **Developer / tester** | tasks assigned to them, their own proposal while it waits for a decision, and approved *unassigned* To do cards (the pool anyone may pick up) |
| **Tester**, in addition | cards waiting in *In testing*, because testers pass or fail them |

So a manager's own tasks, and other people's tasks and timers, are never sent to a developer. A task that is reassigned away from someone disappears from their board within a moment.

## Roles

| | Admin | Manager | Developer | Tester |
|---|:-:|:-:|:-:|:-:|
| See every project, grant admin | ✓ | | | |
| **Create a project** (you become its manager) | ✓ | ✓ | ✓ | ✓ |
| Invite / remove people, change roles | ✓ | ✓ | | |
| **Delete the project**: only the person who created it, whatever their role now is (must type the project key) | | | | |
| Create tasks straight into *To do*, assign, edit, delete | ✓ | ✓ | | |
| **Propose** a task (needs manager approval first) | | | ✓ | ✓ |
| Edit / resubmit / withdraw **own** proposal | | | ✓ | ✓ |
| Approve or decline a proposal (can adjust due date, estimate, assignee) | ✓ | ✓ | | |
| Start / send for review **only tasks assigned to them** (managers can't start, submit or pause someone else's task) | ✓ | ✓ | ✓ | ✓ |
| Approve or send back a review | ✓ | ✓ | | |
| Pass or fail testing | only if the project has no tester | only if the project has no tester | | ✓ |
| Reopen completed tasks | ✓ | ✓ | | |
| **Move any card to any column** (override, reason required) | ✓ | ✓ | | |
| Team workload table | ✓ | ✓ | | |

Admin = workspace level (the first account to sign up). Manager / developer / tester = per project, so one person can be a manager in the project they created and a developer in a project they were invited to.

## Workflow

```
Manager creates ───────────────────────────────────────────────┐
Dev / tester proposes → PROPOSED ─┬─ approve (manager may edit) ┴→ To do → In progress → In review ─┬─ approve, no QA ──────────→ Completed
                                  └─ decline (note) → DECLINED                ▲                      ├─ approve, QA → In testing ─┬─ pass → Completed
                                        │  revise & resubmit ↩                └── send back (note) ──┴────────────────────────────┴─ fail
                                        └─ or withdraw
Review "send back" (note required) → To do; the assignee presses Start work again.
Completed → reopen (note required) → In progress
Manager override: any column ↔ any column (except the Proposed lane), reason required, logged, assignee notified.
```

**Estimate (hours) is optional.** It is a planning aid for managers, not something the person doing the work can know up front; making it mandatory just produced invented numbers. A proposer may suggest one, a manager can set or change it when approving. **Due date and "needs testing?" stay required** because overdue tracking and the QA gate depend on them.

## How the tricky cases are handled

- **Proposals.** Non-managers cannot put work directly into *To do* or assign it to other people. Their task lands in *Proposed*; managers are notified instantly. Nobody (not even the proposer or a manager) can start it until a manager approves it through `approve_task`, which can change due date / estimate / priority / assignee / QA flag in the same step and tells the proposer exactly what was adjusted. Approving needs a future due date. A proposer can't approve their own proposal if another manager exists. Declining requires a reason; the proposer can revise & resubmit (managers are re-notified) or withdraw. Two managers racing on one proposal → the second gets a "no longer waiting for approval" refusal.
- **Manager override.** Drag a card to any column (dashed amber outline) or use *Move to…* in the card. A reason is mandatory, the move is stored in the activity log as a manual move, and the assignee is notified. Guards: can't skip the proposal lane, can't move unassigned work into progress, can't move to *testing* if QA isn't required, can't override-approve your own task when another manager exists.

- **Rules live in the database.** Browsers can only read tables. Every write is a `SECURITY DEFINER` function (`transition_task`, `create_task`, …) that checks role and workflow, locks the row, writes the audit trail and notifications in one transaction. The UI hides illegal moves, but cannot bypass them.
- **Two people act on the same card.** Moves carry the status the user saw; if it changed, the move is refused with "this card was already moved to …" and the card refreshes.
- **Self-approval.** You cannot review or test your own task when someone else could; a sole manager can (otherwise the card would be stuck).
- **No tester in the project.** A manager can pass/fail testing so cards never get stranded.
- **Invitations.** A person becomes a member only after accepting. The invite is bound to the e-mail address (wrong account → clear message), expires in 7 days, can be revoked, and re-inviting replaces the pending one. Pending invites also show on the invitee's Projects page.
- **Removing a member** unassigns their unfinished tasks and moves their in-progress ones back to *To do*. The last manager can't be removed or demoted.
- **Live updates.** Supabase Realtime pushes card moves, new tasks, member changes and notifications. After a dropped connection or a hidden tab the board re-syncs. Everything is persisted, so a browser refresh shows the same state.
- **Overdue.** Cards past due get a red edge. On *Members*, each member's in-progress tasks are listed and overdue ones are highlighted red; the sweep at `/api/cron/overdue` notifies the assignee and managers once per due date.
- **Optimistic moves** roll back with an explanation if the server refuses.

## Notes

- Drag and drop works with a mouse. On touch devices open a card and use the action buttons / *Move to…* (same rules, same server checks).
- **Theme.** The sun/moon/monitor button in the top bar cycles System → Light → Dark and is remembered in `localStorage`. A tiny inline script in `<head>` applies it before first paint.
- **Notifications** arrive over Supabase Realtime with no refresh, ring the bell, and are re-synced after a dropped connection or when a hidden tab wakes up.
- **Browser support.** Layout, animation and theming use widely supported CSS. Dialog/popover fade-ins use `@starting-style` and `allow-discrete` (Chrome 117+, Safari 17.5+, Firefox 129+); older browsers get the same UI without the fade. Popover menus need Chrome 114+, Safari 17+, Firefox 125+.
- Run `npm run typecheck` before deploying.

- **Card order.** Managers can drag a card up or down inside To do / In progress / In review / In testing (blue line shows where it lands). Order is stored in `tasks.position` and synced live. Cards that change column go to the bottom unless dropped on a specific spot.
- **Due date** is date-only (end of that day). **Estimate** stays an optional planning aid.
- Card moves use the View Transitions API (graceful fallback, respects reduced motion).
- **Dialogs.** Confirmations (delete task, remove member, remove own admin) use the in-app dialog (`common/ConfirmHost`, `app.ask()`), never `window.confirm`.

## Folder structure

```
src/
  app/            routes, server actions (actions.ts, auth-actions.ts), global CSS
  components/
    auth/         sign-in and password reset forms
    board/        Kanban board, cards, task drawer, task form, comments
    project/      project header, team workload, invitations, new / delete project
    account/      user menu, settings, profile photo, admin toggle
    timer/        the face-checked work timer
    layout/       top bar, notification bell, theme toggle, links
    common/       dialogs, toasts, date picker, icons and other primitives
  store/          app-wide and per-project state
  lib/            workflow rules, timer maths, face matching, formatting, Supabase clients
supabase/
  schema.sql      everything, for a brand-new project
  migrations/     one-off upgrades for an existing database (see supabase/README.md)
```

## Trying it with two accounts

1. Sign up account **A** first: it becomes the workspace admin. Create a project: A is its manager.
2. In A's project, **Invite people** → enter account **B**'s e-mail, role *Developer*. B must sign up / sign in with that same e-mail, then accept the invite on the Projects page.
3. B now sees the project as a developer: B **proposes** tasks, A approves them. B can also press **New project** to create a separate project where B is the manager.
4. Realtime: keep A and B in two different browsers (or one normal + one private window). Move a card in one and watch it move in the other.
