# Creative Hub

Creative Hub is a private content-management workspace for planning social media content. Milestones 1–3 include login, team roles, Brands, Content Pillars, Campaigns, Content creation, Kanban workflow, Calendar, All Content, a dedicated Content workspace, platform-specific versions, a Media Library, team discussions, approval decisions, and Activity History.

Creative Hub does **not** publish to social media yet. The Scheduled status records the team's plan only.

## What you need

- Node.js 22.13 or newer
- Git
- Access to the Creative Hub Site project for production deployment

## Install and run locally

1. Open a terminal in this project folder.
2. Install the exact saved dependencies:

   ```bash
   npm ci
   ```

3. Copy `.env.example` to `.env.local`.
4. Replace the example owner email with the ChatGPT email of the workspace Owner.
5. Start the local application:

   ```bash
   npm run dev
   ```

6. Open the local URL printed in the terminal.
7. For the local sign-in simulation, visit `/signin-with-chatgpt?return_to=/`.

Never commit `.env.local`, `.dev.vars`, database exports, authentication cookies, or API tokens. These files are ignored by Git.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_OWNER_EMAIL` | The email allowed to create or recover the first Owner membership. |

Use `.env.local` for local development. Production values are managed in Sites settings and must not be written into source files.

## Database and migrations

Creative Hub uses Cloudflare D1. Database definitions live in `db/schema.ts`, while generated migrations live in `drizzle/`.

Uploaded file bytes are stored privately in Cloudflare R2. D1 stores only file metadata and the links between a file, a Content item, and an optional platform version. The application streams private files to signed-in workspace members; it does not expose public R2 URLs.

After changing the schema:

1. Back up production data.
2. Update `db/schema.ts`.
3. Generate a new migration:

   ```bash
   npm run db:generate
   ```

4. Read the new SQL file before deployment.
5. Confirm it does not drop or replace production tables unless a separate verified migration plan explicitly requires that.
6. Test the migration against an in-memory database:

   ```bash
   npm test
   ```

Never edit a migration that has already been applied in production. Add a new migration instead.

Migration `0002_mean_klaw.sql` is intentionally additive. It creates the improved Brand, Campaign, and Activity tables, then adds nullable relationships and new Content fields. Existing rows are linked safely by the idempotent backfill in `db/hub-service.ts` when an authorized member first loads the upgraded workspace.

Migration `0003_milestone_two.sql` is also additive. It adds Media Library metadata, platform versions, attachment tables, and structured Brief and Master Copy fields. The version-3 backfill creates one platform version from each supported legacy Platform value without deleting or overwriting the original Content data. See `docs/milestone-2-migration.md` for deployment and recovery details.

Migrations `0004_certain_living_mummy.sql` and `0005_mighty_frog_thor.sql` are additive Milestone 3 migrations. They add discussions, approval records, workflow status history, and a database rule that permits only one pending review per Content item. The version-4 backfill creates safe baseline records for existing Review, Approved, and Scheduled content. See `docs/milestone-3-migration.md` for deployment and recovery details.

## Media Library limits

- Images and documents: up to 25 MB each.
- Videos: up to 75 MB each.
- Images: JPEG, PNG, WebP, and GIF.
- Videos: MP4, WebM, and QuickTime/MOV.
- Documents: PDF, plain text, CSV, Word, PowerPoint, and Excel formats.

A file cannot be deleted while it is attached to Content or a platform version. Detaching a file never deletes the Media Library copy.

## Quality checks

Run these checks before publishing:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The test suite covers:

- legacy-data preservation;
- login and membership authorization;
- all eight roles;
- every workflow status transition;
- Content creation, editing, deletion, and relationship validation;
- Brand and Campaign archive safety;
- Content Pillar retention behavior;
- server search, filters, and pagination;
- approval actions, concurrency protection, and Activity History.
- safe Milestone 2 migration and legacy platform backfill;
- Content workspace visibility and permissions;
- platform-version creation, editing, and concurrency protection;
- Media Library upload, private preview, search, rename, and deletion permissions;
- Content and platform-version attachment safety.
- discussion comments, replies, resolving, and role permissions;
- review submission, approval, revision, and rejection notes;
- approval-gated scheduling and approval queue visibility;
- workflow status history and collaboration activity records.

## Production deployment

This project is hosted through Sites. Publishing performs these steps in order:

1. Commit and push the exact source version.
2. Apply each pending D1 migration.
3. Build the Cloudflare Worker bundle.
4. Save a new Site version.
5. Deploy that saved version.
6. Verify the final deployment status.

Do not reset the D1 database during deployment. Do not manually copy local database files to production.

## Safe future changes

Before starting work:

1. Confirm `git status` is clean.
2. Pull or open the latest Site source.
3. Create a fresh production backup before schema changes.
4. Make one focused change.
5. Run the full quality checks.
6. Review generated migrations.
7. Commit and publish only after checks pass.

If a deployment fails after a migration is applied, do not edit or replay the applied migration. Fix the application or add a new forward-only migration.

## Current scope

Milestone 3 ends at collaboration, approval, and activity history. The following are intentionally not included yet:

- @mentions and notifications
- Social media account connections
- Publishing queue and automatic publishing
- Publishing logs
- Analytics
- AI Studio
