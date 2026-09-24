# Milestone 1 migration and recovery notes

## Safety goal

The upgrade must preserve all existing members, Content, Content Pillars, Brands, Campaign labels, statuses, planned publish dates, captions, notes, and PIC information.

## Before deployment

- Export every production table to a dated backup.
- Record the table row counts and backup checksum.
- Run `npm test` against the actual migration sequence.
- Inspect `drizzle/0002_mean_klaw.sql` and confirm it contains no `DROP TABLE` or destructive data statements.

## Migration sequence

1. Create the new `brands`, `campaigns`, and `activity_history` tables.
2. Add new Content, Pillar, and Workspace columns with safe constant defaults or nullable relationships.
3. Create indexes used by workspace, date, Brand, Campaign, and Activity queries.
4. Deploy the compatible application code.
5. On the first authorized workspace request, run the idempotent data backfill:
   - copy legacy Brand records into `brands`;
   - copy legacy Campaign records into `campaigns`;
   - connect Pillars to the existing Brand;
   - connect Content to Brand, Campaign, Pillar, and creator IDs;
   - keep the old text labels for compatibility and human-readable exports;
   - mark the Workspace model version as 2 only after all steps succeed.

The legacy `collections` table is retained. It is not deleted during Milestone 1 stabilization.

## Verification after deployment

Compare production row counts and inspect every existing Content row. Each row must retain its original title, status, planned publish date, caption, notes, and PIC. New relationship IDs should be populated.

If the backfill is interrupted, the Workspace remains below model version 2. The next authorized request safely retries the same idempotent steps.

## Recovery

If the application build fails, keep the existing deployed version active. If a migration succeeds but the new version does not, correct the application and publish forward. Do not reset production and do not rewrite an already-applied migration.

No current production record was identified as impossible to migrate. Empty optional values remain empty rather than being invented.
