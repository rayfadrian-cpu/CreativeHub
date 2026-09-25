declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    WORKSPACE_OWNER_EMAIL?: string;
    BUCKET?: R2Bucket;
  }
}
