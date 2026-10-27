# Production persistence and beta conversion rollout

This is a release checklist, not evidence that production has already been configured.

## 1. Durable account database

- Provision a managed PostgreSQL database with backups and a documented restore procedure.
- Set server-side `DATABASE_URL` in the deployment secret store. Use the provider's TLS-required connection string where supported. Never expose it through a `NEXT_PUBLIC_*` variable or commit a real credential.
- The repository's canonical Prisma schema and CI now use PostgreSQL. Before each deployment, run `bun run db:migrate:deploy` against the intended database; do not use `db push` as a production migration strategy.
- Confirm the migration status is clean and that the app's runtime database user has only the required privileges.
- Test with a newly registered account: sign out, close the browser, open a new browser session, sign in again, and verify the account and saved project list remain. Repeat after a fresh application deployment/restart.
- Save a project, change metadata/macros, wait for autosave, leave the studio, sign in again, and restore its settings. Re-select the original source audio; source audio is not uploaded by the project persistence API.
- Verify an export event and AIE compute/export events appear in the authenticated admin metrics after the database write succeeds.
- Configure backups and perform a restore test before claiming the account-loss defect is closed.

## 2. Honest usage evidence

- Historical account, hours, work, export, and AIE counts from the previous session-only beta are unknown. Do not invent, backfill, or present missing historical records as measured zero usage.
- New records begin only when the new deployed code is running with the durable database configured.
- `visibleStudioHours` is an estimate from rate-limited visible-tab heartbeats, not verified human work time. Anonymous browser events are useful funnel signals but are less trustworthy than authenticated account events.
- Keep telemetry notices, retention rules, and deletion/export procedures aligned with the privacy policy.

## 3. Two-free-export beta experiment

- Product capabilities remain open to every user during beta. The first two successful audio exports are free; after that the product presents the planned R49.00 unlock.
- The current implementation is a client-side UX gate because audio encoding is local. It is not tamper-proof paid-access enforcement.
- The current unlock screen records paywall views and checkout intent only. It does not take money or grant a paid entitlement.
- Before charging: integrate a real payment provider; set the amount server-side to ZAR 4,900 cents; verify signed provider callbacks/webhooks; persist payment and entitlement records in PostgreSQL; make callbacks idempotent; handle failures, cancellations, refunds, and disputes; and test success/failure/replay cases in the provider sandbox.
- Count a paid conversion only after the provider confirms payment through a verified server-to-server callback. Never trust a client-supplied `paid=true` value or the current in-memory beta payment engine.

## 4. Release acceptance

Do not close the persistence P0 until all of the following are evidenced:
- [ ] PostgreSQL migration deployment succeeds in the target environment.
- [ ] Account and session survive browser restart and application redeploy.
- [ ] Project settings autosave and restore work end to end.
- [ ] Export and AIE events persist and appear in admin reporting.
- [ ] The two-export allowance works across sign-in and return visits without resetting the count.
- [ ] Payment provider sandbox tests pass before live R49 checkout is enabled.
- [ ] Backup and restore procedure has been exercised.
