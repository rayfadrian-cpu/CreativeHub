# Milestone 2 migration and recovery

This note explains the safe upgrade from Creative Hub Milestone 1 to Milestone 2.

## Backup created before development

A fresh production D1 export was created before the schema work:

- Local ignored file: `work/backups/production-db-backup-pre-m2-2026-09-24.json`
- SHA-256: `687350F4D3C04A6D321F3EF6E9EDE699DB8BD062116FC239B791C901089576C9`
- Contents at backup time: 1 workspace, 1 member, 5 legacy collections, 1 brand, 4 campaigns, 4 pillars, 3 Content items, and 1 activity record.

The backup is intentionally excluded from Git because production exports can contain private workspace data.

## Schema changes

Migration `drizzle/0003_milestone_two.sql` only adds data structures. It does not drop, truncate, replace, or rename an existing production table.

It adds:

- `media_assets` for file metadata;
- `content_platform_variants` for Instagram, TikTok, Facebook, LinkedIn, and YouTube versions;
- `content_media_assets` for Content-level file links;
- `platform_variant_media_assets` for platform-version file links;
- structured Brief fields: key message, content direction, and references;
- structured Master Copy fields: hook, CTA, and copy notes.

Foreign keys prevent a Media Library file from being deleted while it is attached. Deleting a Content item or platform version removes only its attachment links; the original Media Library file remains.

## Automatic version-3 backfill

The first authorized request after deployment performs an idempotent backfill and then changes `workspaces.model_version` from 2 to 3.

For each existing Content item whose Platform is Instagram, TikTok, Facebook, LinkedIn, or YouTube, it creates one platform version containing the existing title, caption, planned publish date, and workflow status. `INSERT OR IGNORE` prevents duplicates if the operation is retried.

Unsupported legacy Platform values stay on the master Content record. They are counted in the migration activity context and are never discarded.

## File storage

Cloudflare R2 stores the file bytes in the private `BUCKET` binding. D1 stores the file name, type, size, optional dimensions/duration, uploader, and private R2 storage key.

The application accepts only the documented MIME types and enforces a 25 MB limit for images/documents and a 75 MB limit for video. Files are served through authenticated application routes with private caching and `nosniff` headers. No R2 public URL or secret is stored in the browser.

## Deployment checklist

1. Keep the pre-deployment backup available and verify its SHA-256 value.
2. Run tests, lint, type checking, and the production build.
3. Review `0003_milestone_two.sql` and confirm it remains additive.
4. Save and deploy a new Sites version so D1 migrations and the R2 binding are provisioned together.
5. Sign in as the existing Owner.
6. Confirm all Brands, Campaigns, Pillars, members, Content items, statuses, and dates still exist.
7. Confirm the workspace model version is 3 and supported legacy Platforms have platform versions.
8. Upload one test image and one test video, preview them, attach and detach them, and verify the original files remain in Media Library.

## Recovery rules

If deployment fails before migration 0003 is applied, keep production on the earlier saved Site version and fix the application before trying again.

If migration 0003 was applied successfully but the new application has a problem, redeploying the previous code is safe because the migration only added nullable/defaulted columns and new tables. Do not delete the new tables and do not edit an already-applied migration.

If production data is ever damaged, stop writes first. Preserve a fresh copy of the damaged database for investigation, then restore from the verified backup using the Sites/D1 recovery process. Do not paste production records into source code or commit a database export.
