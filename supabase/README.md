# Which SQL file do I run?

| Your situation | Run |
|---|---|
| **Brand-new Supabase project** | `schema.sql` only. It already contains everything below (including v12). Do **not** run any migration. |
| **Existing database, not sure what it has** (errors like "function not found in the schema cache", "Only admins can create projects", "That move is not allowed in this workflow") | `migration-v7-sync-all.sql` (one file, replaces v2b to v6) |
| **Existing database** that already has the *Proposed / Declined* columns working | `migration-v3-start-and-sendback.sql`, then `migration-v4-order-and-reorder.sql`, then `migration-v5-anyone-creates-projects.sql`, then `migration-v6-delete-project.sql` |
| **Existing database from the very first version** (no proposals yet) | `migration-v2a-enum.sql` **alone, first**, then v2b, v3, v4, v5, v6 |

Never run `schema.sql` on a database that already has tables (it would fail on `create type`).

All migrations are safe to run again: they use `create or replace`, `if not exists`, or only touch rows that still need it. Keep the order v2a → v2b → v3 → v4 → v5 → v6.

| File | What it does |
|---|---|
| `migration-v2a-enum.sql` | Adds the `proposed` and `declined` statuses (must commit before v2b) |
| `migration-v2b-functions.sql` | Proposal workflow functions, optional estimate |
| `migration-v3-start-and-sendback.sql` | Only the assignee starts work; review "send back" returns to To do |
| `migration-v4-order-and-reorder.sql` | `tasks.position` + `reorder_task()` (drag to reorder inside a column) |
| `migration-v5-anyone-creates-projects.sql` | Any signed-in user can create a project and becomes its manager |
| `migration-v6-delete-project.sql` | `delete_project()`: only the project's creator can delete it (the key must be typed to confirm) |
| `migration-v7-sync-all.sql` | v2b + v3 + v4 + v5 + v6 + v8 + v9 in one run (run v10 separately) (stops with a clear message if v2a is still needed), then reloads the API schema cache |
| `migration-v8-feedback-files.sql` | Photos / PDFs on review remarks: private `task-files` bucket, access rules, `set_decision_files()`. Already ran v7 before this version? Run only this file. |
| `migration-v9-live-invites.sql` | Inviting someone who already has an account notifies them instantly (bell, toast, invitation row). Already ran v7 before this version? Run only this file. |
| `migration-v10-realtime-notifications.sql` | Makes sure `notifications`, `tasks`, `project_members` and `project_invites` are in the realtime publication (fixes "invitation only appears after refresh" on older databases). Safe to run again. |
| `migration-v11-comments-prefs-archive.sql` | Task comments, e-mail notification preferences, editing your own name, clearing notifications, archiving completed tasks. Run once on an existing database (not on a new one made with `schema.sql`, which already has it). Safe to run again. |
| `migration-v12a-on-hold-enum.sql` | Adds the **On hold** status. Run it **alone, first** (it must commit before v12b). |
| `migration-v13-ensure-profile.sql` | Fixes "no profile" at sign-in: the app creates a missing profile itself, the sign-up trigger is re-created, and existing accounts are backfilled. Run once on an existing database (already in `schema.sql`). |
| `migration-v14-live-notifications.sql` | Fixes "invitation / notification only appears after a refresh, or not at all": puts the live tables in the realtime publication, re-applies the notification rules and `create_invite()`, and ends with a check that lists the live tables (expect 4). Run once on an existing database (already in `schema.sql`). Safe to run again. |
| `migration-v12b-timer-and-photo.sql` | Profile photo, one active task per person (the current one moves to On hold when you start another), work timer (`set_task_timer`), On hold moves in `transition_task`. Needs v7 and v11 already applied. Safe to run again, and run it again if you ever re-run v7 (v7 replaces `transition_task`). |

**Upgrading from v11:** run `migration-v12a-on-hold-enum.sql`, wait for "Success", then run `migration-v12b-timer-and-photo.sql`.

**Work timer notes**
- The camera is only on while *you* have a task In progress. The timer runs only while the person captured at sign-up (your profile photo) is at the camera: every frame is compared with that photo. A different face, or nobody, pauses the clock after about 8 seconds ("Not you at the camera" / "Away from camera"); it resumes by itself when you are back. Frames are analysed in your browser and never uploaded; only the 192 px profile photo taken at sign-up is stored.
- A profile photo with no clear face is refused at sign-up and in Settings. An older account whose photo has no face falls back to "any face counts" until the photo is retaken. Match strictness: `MATCH_DISTANCE` in `src/lib/timer.ts`. In a dim room the camera picture is brightened automatically before the face is looked for; in near darkness it cannot see anyone and the clock pauses.
- The face-recognition library (face-api, TensorFlow.js) and its models (about 7 MB, cached after the first time) are loaded from jsDelivr. If your network blocks it the timer pauses with a "Face recognition could not load" message and a Retry button.
- "Idle" and "screen locked" detection uses the browser's Idle Detection API (Chrome / Edge on desktop, one-time permission via the "Detect idle & lock" button). Other browsers still pause when you leave the camera or the computer sleeps. On Chrome / Edge the camera itself is also switched off while the computer is idle or locked, and back on (the clock resumes once you are recognised) when you return.
- The existing hourly cron (`/api/cron/overdue`) also stops clocks whose browser disappeared (`sweep_stale_timers`). Without it, time is still capped at the last heartbeat + 2 minutes when the card is next moved.
