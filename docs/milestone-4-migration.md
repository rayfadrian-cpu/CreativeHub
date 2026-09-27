# Milestone 4 migration and recovery

Milestone 4 adds publishing infrastructure without connecting or calling a social network.

## What the migration adds

Migration `drizzle/0006_brave_zaladane.sql` creates two additive tables:

- `publish_jobs` stores the approved platform version, planned time, queue state, retry count, failure reason, and eventual external result.
- `publish_logs` stores one audit record per processing attempt, including request and response time, platform, account label, attempt number, result, external post ID, and readable error details.

The migration also adds indexes for queue processing and a partial unique index that prevents two active jobs for the same platform version.

It does not drop, rename, replace, or rewrite an existing table. Existing Content, approvals, platform versions, assets, comments, and activity records are preserved.

## Safe deployment order

1. Export the live D1 tables before publishing.
2. Run the complete automated test suite.
3. Run lint, type checking, and a production build.
4. Read the migration and confirm it contains only the two new tables and their indexes.
5. Push the exact tested commit to the Site source repository.
6. Save and deploy a new Site version so the migration is applied before the new routes are used.
7. Confirm the existing workspace still loads and reports model version 5.
8. Open Publishing and verify an approved platform version can be scheduled.

## Current safety behavior

- Only Owner, Admin, and Social Media roles can schedule or manage publishing jobs.
- Only approved Content can enter the queue.
- A Content record with publishing history cannot be permanently deleted.
- Temporary connector errors use bounded retry backoff.
- Permanent errors stop instead of retrying forever.
- Missing connectors produce one clear `CONNECTOR_NOT_CONFIGURED` log and leave the job visible as `blocked`.
- No Milestone 4 code calls a real social API.

## Recovery

If deployment fails before the migration is applied, keep production on the previous saved Site version and fix the application before retrying.

If the migration was applied but the application build fails, do not edit or delete migration `0006`. Fix the application and publish a new forward-only version. The two empty publishing tables are harmless to the previous application version.

If data restoration is required, restore only from the verified pre-Milestone-4 export. Do not reset the whole D1 database, because that would erase live Content and collaboration data.
