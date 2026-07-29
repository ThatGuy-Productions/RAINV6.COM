# Incident Updates

## Update 1 — July 25, 2026

### Status: Resolved

**Issue:** Database schema migration (`prisma db push --accept-data-loss`) destroyed all user data on July 20th, 2026. Approximately 135 beta user accounts were lost.

**Root Cause:** The `--accept-data-loss` flag was used to push a schema change (adding the Review model). This flag drops and recreates all database tables, destroying existing data. The `dev.sh` script also ran `db:push` on every server restart, compounding the risk.

**Actions Taken:**
1. **Root cause identified** — confirmed the `--accept-data-loss` flag destroyed the data
2. **`dev.sh` fixed** — the script now only runs `db:push` if the database file doesn't exist. Existing databases are preserved across restarts. Only `db:generate` runs (which doesn't touch data).
3. **Service notice banner added** — a dismissible amber banner now appears at the top of the landing page, informing users of the issue and that it's resolved. Users who can't log in are directed to re-register.
4. **Incident report created** — full documentation at `INCIDENT-REPORT-DATA-LOSS.md`

**Prevention Measures:**
- `dev.sh` no longer runs destructive database commands on restart
- Future schema changes will use `prisma migrate dev` (versioned, data-preserving migrations)
- Database backups should be implemented (daily snapshots of `db/custom.db`)
- The `--accept-data-loss` flag will never be used on a database with real user data

**User Impact:**
- ~135 users need to re-register
- Previous sessions, renders, and analytics data are unrecoverable
- A dismissible banner on the landing page informs users of the issue

**Files Changed:**
- `.zscripts/dev.sh` — conditional `db:push` (only if DB doesn't exist)
- `src/components/rain/landing/ServiceNoticeBanner.tsx` — new dismissible banner
- `src/components/rain/landing/LandingPage.tsx` — added banner to landing

**Communication:**
- Landing page banner: "Service Notice: A database issue on July 20th may have affected some beta accounts. The issue is resolved — if you can't log in, please re-register. We apologize for the inconvenience."
- Affected users should be contacted via the 135 DMs with a re-registration request

**Next Steps:**
- Contact all 135 affected users
- Implement automated database backups
- Switch to `prisma migrate dev` for all future schema changes
- Remove the ServiceNoticeBanner component once all users have been re-contacted

---

*This file is updated as new information becomes available.*
