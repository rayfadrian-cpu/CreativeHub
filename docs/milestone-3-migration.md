# Milestone 3 migration and recovery

This note explains the safe upgrade from Creative Hub Milestone 2 to Milestone 3.

## Backup created before development

A fresh production D1 backup was created before any Milestone 3 schema work:

- Local ignored file: `work/backups/production-db-backup-pre-m3-2026-09-25.json`
- SHA-256: `AD8BF3F78B1638328ABBDFAFE1ECB023912CC581CC7284F8616F54DA57C89597`
- Row counts at backup time: 1 workspace, 1 member, 1 brand, 4 campaigns, 4 pillars, 3 Content items, 3 platform versions, 2 Media Library files, 0 content attachments, 0 platform-version attachments, 5 legacy collections, and 6 activity records.

The backup is outside the Site checkout and is intentionally excluded from Git because it contains private production data.

## Additive schema changes

Migration `drizzle/0004_certain_living_mummy.sql` adds three tables without dropping or replacing any existing table:

- `comments` stores main discussions and one-level replies, including resolved state;
- `approvals` stores each review request, decision, note, member, timestamp, and reviewed Content version;
- `content_status_history` stores each workflow transition separately from the general activity feed.

Migration `drizzle/0005_mighty_frog_thor.sql` adds a partial unique index so one Content item cannot have two pending approval requests at the same time.

Both migrations are forward-only and preserve all Milestone 1 and 2 data.

## Automatic version-4 backfill

The first authorized request after deployment changes `workspaces.model_version` from 3 to 4 after preparing baseline collaboration records.

- Every existing Content item receives a status-history baseline.
- Existing Review items receive one pending approval record.
- Existing Approved or Scheduled items receive one migrated approved record, so legitimate existing work can continue to the future scheduling workflow.
- Existing titles, captions, dates, statuses, assets, and platform versions are not changed.

The backfill uses `NOT EXISTS` and `INSERT OR IGNORE`, so retrying an interrupted request does not create duplicate records.

## Security and workflow rules

- All comment and approval routes verify the signed-in member, workspace, role, and Content visibility on the server.
- Viewer cannot comment or make approval decisions.
- Only Owner, Admin, or Approver can approve, request revision, or reject.
- Revision and rejection require a note.
- Direct movement into Approved or approval-driven Revision is blocked; the decision route must be used.
- Scheduled is allowed only after an approved review record exists.
- Optimistic version checks prevent an old browser tab from overwriting a newer Content version.

## Deployment checklist

1. Keep the backup above available and verify its SHA-256.
2. Run tests, lint, type checking, and the production build.
3. Review both generated SQL migrations and confirm they only create tables and indexes.
4. Save and deploy a new Sites version.
5. Sign in as the existing Owner to trigger the version-4 backfill.
6. Confirm the existing three Content items, two Media Library files, Brands, Campaigns, and Pillars remain unchanged.
7. Add a comment and reply, resolve and reopen the discussion, and check Activity.
8. Submit a Content item for review, request a revision with a note, resubmit, approve, and confirm it can then move to Scheduled.
9. Confirm the new Approvals page lists the review and its decision history.

## Recovery rules

If deployment fails before migrations 0004 and 0005 are applied, keep production on the earlier saved Site version and fix the application before retrying.

If either migration has already been applied, do not delete its tables or edit the applied SQL. The changes are additive, so the previous code can still run while a forward fix is prepared. Preserve a fresh database copy before any recovery work.

If production data is damaged, stop writes first, preserve a copy of the damaged database for investigation, and restore only from a verified backup through the Sites/D1 recovery process.
