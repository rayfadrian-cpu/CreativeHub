# Creative Hub

Creative Hub is a private content-management workspace for planning social media content. Milestone 1 includes login, team roles, Brands, Content Pillars, Campaigns, Content creation, Kanban workflow, Calendar, All Content, and Activity History.

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

Milestone 1 ends at content planning and team workflow. The following are intentionally not included yet:

- Media Library and file uploads
- Platform-specific content versions
- Social media account connections
- Publishing queue and automatic publishing
- Publishing logs
- Analytics
- AI Studio
