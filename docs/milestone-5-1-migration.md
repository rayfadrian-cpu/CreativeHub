# Milestone 5.1 migration

Migration `0008_workable_proemial_gods.sql` is forward-only and additive. It adds:

- `content_platform_variants.publish_format`, with a constant `Single image` default;
- `content_media_assets.alt_text`; and
- `platform_variant_media_assets.alt_text`.

No existing table, row, file, attachment, publishing job, or log is removed. When an authorized member first opens a workspace after deployment, the model-version 6 backfill classifies existing platform versions from their platform, master content format, and attached media. This preserves existing Instagram Reels and carousel plans instead of treating every old record as a single image.

Before deployment, run the full test suite, TypeScript check, and production build. The migration uses only `ALTER TABLE ... ADD` statements with constant non-null defaults, which are safe for the existing D1 tables.

If deployment fails after the migration is applied, do not edit or remove this migration. Fix the application forward or add a later additive migration.
