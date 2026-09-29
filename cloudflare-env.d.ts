declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WORKSPACE_OWNER_EMAIL?: string;
    BUCKET?: R2Bucket;
    INSTAGRAM_APP_ID?: string;
    INSTAGRAM_APP_SECRET?: string;
    INSTAGRAM_API_VERSION?: string;
    SOCIAL_TOKEN_ENCRYPTION_KEY?: string;
  }
}
