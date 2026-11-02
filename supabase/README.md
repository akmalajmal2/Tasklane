# Which SQL file do I run?

| Your situation | Run |
|---|---|
| **New Supabase project** | `schema.sql` only. It already contains every migration below. |
| **Existing database, unsure what it has** | `migrations/migration-v7-sync-all.sql`, then the later files in order (v11, v12a, v12b, v13, v14, v15, v17). Each is safe to run again. |
| **Existing database, up to date except for who sees what** | `migrations/migration-v17-private-tasks.sql` |

Never run `schema.sql` on a database that already has tables (it would fail on `create type`).
Very old database (before proposals existed)? Run `migrations/migration-v2a-enum.sql` alone first, then v7.

| File | What it does |
|---|---|
| `migration-v2a-enum.sql` | Adds the `proposed` / `declined` statuses. Run alone, before v7, only on a very old database. |
| `migration-v7-sync-all.sql` | Proposal workflow, only the assignee starts work, card order, anyone creates projects, delete project, review files, live invites. Replaces the old v2b to v6 files. |
| `migration-v8-feedback-files.sql`, `v9-live-invites.sql` | Already inside v7. Only needed if you ran v7 before these existed. |
| `migration-v10-realtime-notifications.sql`, `v14-live-notifications.sql` | Make sure the live tables are in the realtime publication (fixes "invitation only appears after refresh"). |
| `migration-v11-comments-prefs-archive.sql` | Comments, e-mail preferences, editing your name, clearing notifications, archiving completed tasks. |
| `migration-v12a-on-hold-enum.sql` | Adds the **On hold** status. Run alone, first. |
| `migration-v12b-timer-and-photo.sql` | Profile photo, one active task per person, work timer, On hold moves. Needs v7 and v11. Run again if you ever re-run v7. |
| `migration-v13-ensure-profile.sql` | Fixes "no profile" at sign-in. |
| `migration-v15-roles-fix.sql` | A member's project role decides; a workspace admin only acts as manager on projects they have not joined. |
| `migration-v17-private-tasks.sql` | **Privacy.** A manager sees every task and timer. Anyone else sees only tasks assigned to them, their own pending proposal, and unassigned To do cards (testers also see In testing). Covers the board, history, comments, files and live updates. Replaces v16, which also let a proposer keep seeing a task after it was given to someone else. |

## Work timer notes

- The camera is only on while *you* have a task In progress. The clock runs only while the person from your profile photo is at the camera; a different face, or nobody, pauses it after about 8 seconds and it resumes by itself. Frames are analysed in the browser and never uploaded; only the small profile photo taken at sign-up is stored.
- A profile photo with no clear face is refused at sign-up and in Settings. An older account whose photo has no face falls back to "any face counts" until the photo is retaken. Strictness: `MATCH_DISTANCE` in `src/lib/timer.ts`.
- The face-recognition library and models (about 7 MB, cached) load from jsDelivr. If your network blocks it, the timer pauses with a Retry button.
- Idle / screen-lock detection uses the Idle Detection API (Chrome / Edge desktop, one-time permission). Other browsers still pause when you leave the camera or the computer sleeps.
- The hourly cron (`/api/cron/overdue`) also stops clocks whose browser disappeared (`sweep_stale_timers`). Without it, time is capped at the last heartbeat + 2 minutes when the card is next moved.
