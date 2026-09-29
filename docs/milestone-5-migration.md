# Milestone 5 migration

Migration `0007_sudden_tana_nile.sql` is forward-only and additive.

## What it adds

- `social_accounts` for one or more provider identities, encrypted access tokens, token expiry, connection health, and audit ownership.
- `social_oauth_states` for short-lived, single-use OAuth state validation.
- Optional `social_account_id` and `provider_container_id` fields on `publish_jobs`.

The migration does not delete or rewrite Content, Media Library, approval, publishing job, or publishing log records.

## Required production configuration

Set these values in the Sites environment settings before enabling the Connect button:

- `INSTAGRAM_APP_ID` — secret
- `INSTAGRAM_APP_SECRET` — secret
- `SOCIAL_TOKEN_ENCRYPTION_KEY` — secret; base64 encoding of exactly 32 random bytes
- `INSTAGRAM_API_VERSION` — plain value, currently `v25.0`

Configure this exact OAuth redirect URI in the Meta App:

`https://creative-hub-studio.ray-f-adrian.chatgpt.site/api/hub/integrations/instagram/callback`

Never write the Meta App secret, encryption key, or an Instagram access token into Git, source files, browser storage, screenshots, or support messages.

## Verification

1. Apply the migration once.
2. Open Publishing and confirm the Instagram connection card appears.
3. Connect an Instagram Business or Creator account using Meta's authorization page.
4. Confirm the card shows the Instagram username without exposing any token.
5. Attach one image or video to an approved Instagram platform version.
6. Schedule and process the job.
7. Confirm the job, external post ID/link, attempt log, and Activity History entry.

If deployment fails after this migration is applied, keep the schema in place and deploy a forward fix. Do not edit or replay an applied migration.
