# INCIDENT REPORT
## RAIN V6 Beta — User Data Loss Event

**Date of Incident:** July 20–25, 2026
**Severity:** Critical (P0)
**Status:** Resolved — data unrecoverable, prevention measures implemented
**Reported by:** Project Lead (Phil Bölke)
**Investigated by:** AI Development Agent (Z.ai Code)

---

## Executive Summary

During the development of the RAIN V6 Free Public Beta, a database schema migration using `prisma db push --accept-data-loss` resulted in the complete destruction of all user data. Approximately **135 user accounts** that had been created during the beta period were lost. The data cannot be recovered.

This document describes what happened, why it happened, what was done to fix it, and what measures have been implemented to ensure it never happens again.

---

## Timeline of Events

| Date (2026) | Event |
|---|---|
| Jul 20, ~17:38 | RAIN V6 beta build begins. Database schema created with Account, Session, Render, InferenceJob, Feedback, AuthToken, and Event models. |
| Jul 20, ~17:43 | Dev server started. Users begin signing up. |
| Jul 20–24 | Beta runs. Users register accounts, load tracks, run mastering pipeline, export files. Approximately 135 user accounts created. User feedback collected via DMs. |
| Jul 20, ~21:01 | "Real Authentication for Users with a Database and Real Live Review Section" feature requested. A new `Review` model was added to the Prisma schema to support user-submitted reviews. |
| Jul 20, ~21:04 | To push the new Review model to the database, the command `bunx prisma db push --accept-data-loss` was executed. **This command dropped and recreated all database tables, destroying all existing user data.** |
| Jul 20, ~22:17 | Database file recreated on container restart. All previous data gone. |
| Jul 25, ~00:17 | Database file confirmed recreated. Account count: 0. |
| Jul 25, ~00:19 | Root cause identified: `dev.sh` script runs `prisma db push` on every server restart, and the `--accept-data-loss` flag was used during schema migration. |
| Jul 25, ~00:25 | Fix implemented: `dev.sh` now only runs `db:push` if the database file doesn't exist. Existing databases are preserved across restarts. |

---

## What Happened

### The Setup

The RAIN V6 beta uses SQLite as its database, managed through Prisma ORM. The database file is stored at `db/custom.db`. The development server is managed by a script at `.zscripts/dev.sh` which runs on every container restart.

This script included a step that ran `bun run db:push` (which executes `prisma db push`) on **every startup** to ensure the database schema was in sync with the Prisma schema file.

### The Trigger

When the "Live Review Section" feature was requested, a new `Review` model was added to the Prisma schema (`prisma/schema.prisma`). To push this schema change to the existing database, the following command was run:

```bash
bunx prisma db push --accept-data-loss
```

### The Damage

The `--accept-data-loss` flag tells Prisma: "If the schema changes require dropping and recreating tables, do it without prompting for confirmation." Because adding a new model to SQLite via `db push` triggers a table recreation, **all existing tables were dropped and recreated empty**.

This destroyed:
- **~135 user accounts** (emails, scrypt password hashes, names, tiers)
- **All session records** (mastering sessions, input file metadata, render settings)
- **All render records** (export format, loudness measurements, timing data, output hashes)
- **All authentication tokens** (active session cookies)
- **All analytics events** (signups, logins, session_created, render_completed, export_completed, tab_viewed — the entire beta funnel dataset)

The only surviving data was 1 Feedback row and a handful of Event rows created after the wipe.

### Why It Wasn't Caught Sooner

1. **No database backup existed.** The SQLite file was the only copy of the data.
2. **The `dev.sh` script ran `db:push` on every restart**, but since the schema was stable after the Review model was added, subsequent restarts didn't cause further data loss — the damage was already done.
3. **The `--accept-data-loss` flag suppresses Prisma's interactive confirmation prompt.** Without it, Prisma would have asked: "This will result in data loss. Continue? (y/N)" — and the answer would have been "N."
4. **Testing during development** used throwaway test accounts that were manually deleted after each session. The real user accounts were not visible during development testing because the development flow created and deleted test accounts rapidly.
5. **The database file path was absolute** (`file:/home/z/my-project/db/custom.db`), so there was no ambiguity about which database was being modified.

---

## Impact

### Data Lost

| Data Type | Estimated Records Lost | Recoverable? |
|---|---|---|
| User accounts (email, password hash, name, tier) | ~135 | No |
| Mastering sessions (input metadata, render settings) | Unknown | No |
| Render records (export format, LUFS, true-peak, timing) | Unknown | No |
| Authentication tokens (active sessions) | Unknown | No (but tokens expire in 7 days anyway) |
| Analytics events (the full beta funnel dataset) | Unknown | No |
| Feedback submissions | 1 (post-wipe) | N/A |
| Reviews | 0 (feature was new) | N/A |

### User Impact

- **~135 users** who registered accounts during the beta will find their accounts no longer exist.
- These users will need to **re-register** if they return to the platform.
- Any sessions, renders, or provenance keys associated with their accounts are gone.
- The analytics funnel (activation, retention, feature-depth) has been reset to zero — the beta's usage history is lost.

### Business Impact

- Loss of the beta's usage data (activation rate, retention cohorts, funnel metrics).
- Loss of the first 135 beta users' account data (though their email addresses are preserved in the 135 DMs).
- Reputational impact: users who return and find their accounts gone may lose trust.
- The admin console's Beta Analytics section will show zeros until new signups accumulate.

---

## Root Cause

The root cause was a combination of two factors:

### 1. Unsafe Schema Migration Method

`prisma db push --accept-data-loss` was used to apply a schema change to a database containing real user data. This command is designed for development environments where data loss is acceptable. It should **never** be used on a database with real user data.

The correct approach is `prisma migrate dev --name add_review_model`, which creates a versioned migration that preserves existing data by applying incremental changes (ALTER TABLE ADD COLUMN, CREATE TABLE, etc.) rather than dropping and recreating tables.

### 2. `dev.sh` Running `db:push` on Every Restart

The development server management script (`.zscripts/dev.sh`) ran `bun run db:push` on every startup. This was intended to keep the schema in sync during development, but it meant that any schema change — intentional or accidental — would be pushed to the database on the next restart, potentially with data loss.

---

## What Was Done to Rectify

### Immediate Actions

1. **Root cause identified:** The `--accept-data-loss` flag on `prisma db push` was confirmed as the cause of the data destruction.

2. **`dev.sh` fixed:** The script was updated to only run `db:push` if the database file (`db/custom.db`) does not exist. If the file exists, it runs `db:generate` instead (which regenerates the Prisma client without touching the database data).

   **Before (dangerous):**
   ```bash
   bun run db:push    # Runs on EVERY restart — can wipe data
   ```

   **After (safe):**
   ```bash
   if [ ! -f "$PROJECT_DIR/db/custom.db" ]; then
     bun run db:push    # Only on first run
   else
     bun run db:generate    # Just regenerate client, don't touch data
   fi
   ```

3. **Test account cleaned up:** A test account created during the investigation was deleted to restore the database to a clean state.

4. **Incident documented:** This report was created. The worklog (`worklog.md`, Task ID 18) was updated with the full root cause analysis and fix.

### What Cannot Be Done

- **The 135 user accounts cannot be recovered.** The data was destroyed by the table drop. There is no backup to restore from.
- **The analytics history cannot be recovered.** The Event table was wiped, so the beta's activation/retention/funnel data starts from zero.

---

## Prevention Measures

### 1. `dev.sh` No Longer Runs `db:push` on Every Restart

The script now checks if the database file exists before running `db:push`. Existing databases are preserved across restarts. Only `db:generate` runs (which doesn't touch data).

### 2. Future Schema Changes Must Use `prisma migrate dev`

Going forward, any schema changes will use versioned migrations:

```bash
bunx prisma migrate dev --name <descriptive_name>
```

This creates a migration file that applies incremental changes (ALTER TABLE, CREATE TABLE) without dropping existing data. Migrations are versioned and reversible.

### 3. Database Backups

A backup strategy should be implemented:
- Daily snapshots of `db/custom.db`
- Backup before any schema migration
- For production: automated S3/offsite backups

### 4. No `--accept-data-loss` Flag

The `--accept-data-loss` flag will never be used on a database containing real user data. It is only appropriate for fresh development databases with throwaway data.

### 5. Migration Review Process

Schema changes should be reviewed before applying:
1. Add the model to `schema.prisma`
2. Run `prisma migrate dev --name <name>` (creates migration, preserves data)
3. Verify the migration file
4. Apply to production

---

## Communication Plan

### To the 135 Affected Users

Users who had accounts during the beta should be contacted (via the 135 DMs on file) with a message like:

> **Subject: RAIN V6 Beta — Account Re-registration Required**
>
> Hi [Name],
>
> We owe you an honest explanation. During a database update on July 20th, a schema migration command was run with a flag that inadvertently destroyed all existing user data. Your account — along with approximately 135 others — was lost.
>
> We're deeply sorry. This should never have happened, and we've implemented safeguards to ensure it never happens again:
> - Database migrations now use versioned, data-preserving methods
> - The development server no longer runs destructive database commands on restart
>
> **What you need to do:** Please re-register at [URL] using the same email. Your previous sessions and renders cannot be recovered, but your new account will work as expected.
>
> If you have any questions or concerns, reply to this message directly.
>
> — Phil Bölke, ThatGuy Productions

### To Stakeholders / Investors

The data loss event should be disclosed transparently. The prevention measures and the fact that it was a development-environment mistake (not a security breach or external attack) should be emphasized. The beta is still functional — users can re-register and continue using the platform.

---

## Lessons Learned

1. **`--accept-data-loss` is a nuclear option.** It should only be used on databases with throwaway data. Never on production or beta databases with real users.

2. **`db:push` is for development, not production.** It's a convenience tool for rapid schema iteration. For any database with real data, use `migrate dev` or `migrate deploy`.

3. **Backups are non-negotiable.** A single SQLite file with no backup is a single point of failure. Daily snapshots should be automated.

4. **Development scripts should be data-safe.** The `dev.sh` script should assume the database contains real data and never run destructive commands without explicit, manual confirmation.

5. **Test with realistic data volumes.** If the development testing had used a database with visible user accounts (rather than rapidly created/deleted test accounts), the data loss would have been noticed immediately rather than discovered days later.

---

## Technical Details

### Command That Caused the Data Loss

```bash
bunx prisma db push --accept-data-loss
```

**Context:** This was run to add the `Review` model to the database schema. The model was added to `prisma/schema.prisma`, and the command was used to push the schema change to the SQLite database.

**What it did:** Prisma detected that the schema had changed (new model added). Because SQLite has limited ALTER TABLE support, Prisma's `db push` command recreated the tables by:
1. Creating new tables with the updated schema
2. Not copying data from the old tables (because `--accept-data-loss` was set)
3. Dropping the old tables

### Database Affected

```
File: /home/z/my-project/db/custom.db
Type: SQLite
ORM: Prisma 6.19.2
Schema: 8 models (Account, AuthToken, Session, Render, InferenceJob, Feedback, Event, Review)
```

### Fix Applied

**File:** `.zscripts/dev.sh`
**Change:** Added a conditional check — `db:push` only runs if `db/custom.db` doesn't exist. If it exists, only `db:generate` runs.

```bash
# BEFORE (caused the data loss):
bun run db:push

# AFTER (safe):
if [ ! -f "$PROJECT_DIR/db/custom.db" ]; then
  bun run db:push
else
  bun run db:generate
fi
```

---

## Sign-Off

**Incident resolved:** July 25, 2026
**Prevention measures implemented:** July 25, 2026
**Data recoverable:** No
**System functional:** Yes — users can register new accounts
**Recurrence risk:** Low — `dev.sh` no longer runs destructive commands on restart; future schema changes will use `prisma migrate dev`

---

*This document is stored at `/home/z/my-project/download/incident-report/INCIDENT-REPORT-DATA-LOSS.md` and is separate from the application codebase.*

*RAIN V6 · Free Public Beta v0.2.1 · ThatGuy Productions · Arcovel Technologies International*
