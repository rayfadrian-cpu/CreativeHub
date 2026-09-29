import { managers, type Actor } from "../lib/hub-types.ts";
import { HubError } from "./hub-error.ts";
import type { PublishingConnector, PublishingConnectors } from "./milestone-four.ts";

export type InstagramConfig = {
  appId: string;
  appSecret: string;
  encryptionKey: string;
  apiVersion: string;
};

type Context = {
  db: D1Database;
  bucket?: R2Bucket;
  actor: Actor;
  origin: string;
  config: InstagramConfig;
};

type SocialAccountRow = {
  id: number;
  workspaceId: string;
  providerAccountId: string;
  username: string;
  displayName: string;
  accountType: string;
  profilePictureUrl: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenExpiresAt: string;
  scopes: string;
  status: string;
  lastVerifiedAt: string;
  lastErrorCode: string;
  lastErrorMessage: string;
  createdAt: string;
  updatedAt: string;
};

type GraphErrorPayload = { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean } };

class GraphError extends Error {
  code: number;
  transient: boolean;
  constructor(code: number, transient: boolean, message: string) {
    super(message);
    this.code = code;
    this.transient = transient;
  }
}

const accountColumns = `id, workspace_id AS workspaceId, provider_account_id AS providerAccountId,
  username, display_name AS displayName, account_type AS accountType, profile_picture_url AS profilePictureUrl,
  token_ciphertext AS tokenCiphertext, token_iv AS tokenIv, token_expires_at AS tokenExpiresAt,
  scopes, status, last_verified_at AS lastVerifiedAt, last_error_code AS lastErrorCode,
  last_error_message AS lastErrorMessage, created_at AS createdAt, updated_at AS updatedAt`;

const noStoreHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const configured = (config: InstagramConfig) => Boolean(config.appId && config.appSecret && config.encryptionKey);
const instagramLabel = (account: Pick<SocialAccountRow, "username" | "displayName">) => account.username ? `@${account.username}` : account.displayName || "Instagram account";
const deny = (): never => { throw new HubError("Only an Owner or Admin can manage social account connections.", 403); };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function encryptionCryptoKey(value: string) {
  const raw = base64ToBytes(value);
  if (raw.byteLength !== 32) throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSocialToken(token: string, encryptionKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionCryptoKey(encryptionKey), new TextEncoder().encode(token));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSocialToken(ciphertext: string, iv: string, encryptionKey: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionCryptoKey(encryptionKey), base64ToBytes(ciphertext));
  return new TextDecoder().decode(decrypted);
}

export async function hashOauthState(state: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))));
}

async function signingKey(value: string) {
  return crypto.subtle.importKey("raw", base64ToBytes(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signPublishingMedia(workspaceId: string, assetId: number, expires: number, encryptionKey: string) {
  const message = new TextEncoder().encode(`${workspaceId}:${assetId}:${expires}`);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(encryptionKey), message)));
}

export async function verifyPublishingMediaSignature(workspaceId: string, assetId: number, expires: number, signature: string, encryptionKey: string) {
  if (!signature || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const padded = signature.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - signature.length % 4) % 4);
  try {
    return crypto.subtle.verify("HMAC", await signingKey(encryptionKey), base64ToBytes(padded), new TextEncoder().encode(`${workspaceId}:${assetId}:${expires}`));
  } catch { return false; }
}

function publicAccount(account: SocialAccountRow | null) {
  if (!account) return null;
  return {
    id: account.id,
    platform: "Instagram" as const,
    username: account.username,
    displayName: account.displayName,
    accountType: account.accountType,
    profilePictureUrl: account.profilePictureUrl,
    tokenExpiresAt: account.tokenExpiresAt,
    scopes: account.scopes,
    status: account.status,
    lastVerifiedAt: account.lastVerifiedAt,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function activeAccount(db: D1Database, workspaceId: string) {
  return db.prepare(`SELECT ${accountColumns} FROM social_accounts
    WHERE workspace_id = ? AND platform = 'Instagram' AND status = 'connected'
    ORDER BY updated_at DESC, id DESC LIMIT 1`).bind(workspaceId).first<SocialAccountRow>();
}

async function activity(ctx: Context, action: string, accountId: number | string, title: string, summary: string) {
  await ctx.db.prepare(`INSERT INTO activity_history
    (workspace_id, actor_member_id, actor_name, action, entity_type, entity_id, entity_title, summary, context)
    VALUES (?, ?, ?, ?, 'social_account', ?, ?, ?, '{}')`)
    .bind(ctx.actor.workspaceId, ctx.actor.id, ctx.actor.name, action, String(accountId), title, summary).run();
}

async function graphJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & GraphErrorPayload;
  if (!response.ok || body.error) {
    const error = body.error;
    const code = Number(error?.code ?? response.status);
    const retryable = Boolean(error?.is_transient) || [1, 2, 4, 17, 32, 341, 429, 500, 502, 503, 504].includes(code);
    throw new GraphError(code, retryable, error?.message || "Instagram did not accept the request.");
  }
  return body;
}

function redirectBack(origin: string, result: "connected" | "cancelled" | "error") {
  return Response.redirect(`${origin}/?instagram=${result}#publishing`, 303);
}

async function beginConnection(ctx: Context) {
  if (!managers(ctx.actor.role)) deny();
  if (!configured(ctx.config)) throw new HubError("Instagram setup is not ready yet. Add the Meta App credentials in the hosting settings first.", 409);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const stateHash = await hashOauthState(state);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM social_oauth_states WHERE workspace_id = ? AND expires_at < ?").bind(ctx.actor.workspaceId, new Date().toISOString()),
    ctx.db.prepare(`INSERT INTO social_oauth_states (state_hash, workspace_id, member_id, expires_at)
      VALUES (?, ?, ?, ?)`).bind(stateHash, ctx.actor.workspaceId, ctx.actor.id, expiresAt),
  ]);
  const redirectUri = `${ctx.origin}/api/hub/integrations/instagram/callback`;
  const authorization = new URL("https://www.instagram.com/oauth/authorize");
  authorization.searchParams.set("client_id", ctx.config.appId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  authorization.searchParams.set("state", state);
  return Response.json({ authorizationUrl: authorization.toString() }, { headers: noStoreHeaders });
}

async function finishConnection(request: Request, ctx: Context) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectBack(ctx.origin, "cancelled");
  if (!configured(ctx.config)) return redirectBack(ctx.origin, "error");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return redirectBack(ctx.origin, "error");
  const stateHash = await hashOauthState(state);
  const now = new Date().toISOString();
  const oauthState = await ctx.db.prepare(`SELECT member_id AS memberId FROM social_oauth_states
    WHERE state_hash = ? AND workspace_id = ? AND used_at = '' AND expires_at >= ?`)
    .bind(stateHash, ctx.actor.workspaceId, now).first<{ memberId: number }>();
  if (!oauthState || oauthState.memberId !== ctx.actor.id) return redirectBack(ctx.origin, "error");
  const consumed = await ctx.db.prepare("UPDATE social_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at = ''")
    .bind(now, stateHash).run();
  if (!consumed.success || Number(consumed.meta.changes ?? 0) !== 1) return redirectBack(ctx.origin, "error");

  try {
    const redirectUri = `${ctx.origin}/api/hub/integrations/instagram/callback`;
    const form = new FormData();
    form.set("client_id", ctx.config.appId);
    form.set("client_secret", ctx.config.appSecret);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);
    form.set("code", code);
    const short = await graphJson<{ access_token: string; user_id?: number }>("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const exchange = new URL("https://graph.instagram.com/access_token");
    exchange.searchParams.set("grant_type", "ig_exchange_token");
    exchange.searchParams.set("client_secret", ctx.config.appSecret);
    exchange.searchParams.set("access_token", short.access_token);
    const long = await graphJson<{ access_token: string; expires_in?: number }>(exchange.toString());
    const profileUrl = new URL(`https://graph.instagram.com/${ctx.config.apiVersion}/me`);
    profileUrl.searchParams.set("fields", "id,user_id,username,name,account_type,profile_picture_url");
    profileUrl.searchParams.set("access_token", long.access_token);
    const profile = await graphJson<{ id: string; user_id?: string; username?: string; name?: string; account_type?: string; profile_picture_url?: string }>(profileUrl.toString());
    const providerAccountId = String(profile.user_id || profile.id || short.user_id || "");
    if (!providerAccountId) throw new Error("Instagram did not return an account identifier.");
    const encrypted = await encryptSocialToken(long.access_token, ctx.config.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + Number(long.expires_in ?? 5_184_000) * 1000).toISOString();
    await ctx.db.batch([
      ctx.db.prepare(`UPDATE social_accounts SET status = 'disconnected', token_ciphertext = '', token_iv = '',
        disconnected_by_member_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND platform = 'Instagram' AND provider_account_id <> ? AND status = 'connected'`)
        .bind(ctx.actor.id, ctx.actor.workspaceId, providerAccountId),
      ctx.db.prepare(`INSERT INTO social_accounts
        (workspace_id, platform, provider_account_id, username, display_name, account_type, profile_picture_url,
         token_ciphertext, token_iv, token_expires_at, scopes, status, last_verified_at,
         last_error_code, last_error_message, connected_by_member_id, disconnected_by_member_id)
        VALUES (?, 'Instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, '', '', ?, NULL)
        ON CONFLICT(workspace_id, platform, provider_account_id) DO UPDATE SET
          username = excluded.username, display_name = excluded.display_name, account_type = excluded.account_type,
          profile_picture_url = excluded.profile_picture_url, token_ciphertext = excluded.token_ciphertext,
          token_iv = excluded.token_iv, token_expires_at = excluded.token_expires_at, scopes = excluded.scopes,
          status = 'connected', last_verified_at = excluded.last_verified_at, last_error_code = '',
          last_error_message = '', connected_by_member_id = excluded.connected_by_member_id,
          disconnected_by_member_id = NULL, updated_at = CURRENT_TIMESTAMP`)
        .bind(ctx.actor.workspaceId, providerAccountId, profile.username ?? "", profile.name ?? "", profile.account_type ?? "PROFESSIONAL",
          profile.profile_picture_url ?? "", encrypted.ciphertext, encrypted.iv, tokenExpiresAt,
          "instagram_business_basic instagram_business_content_publish", now, ctx.actor.id),
    ]);
    const account = await activeAccount(ctx.db, ctx.actor.workspaceId);
    if (account) await activity(ctx, "instagram_connected", account.id, instagramLabel(account), "Instagram professional account connected securely.");
    return redirectBack(ctx.origin, "connected");
  } catch {
    return redirectBack(ctx.origin, "error");
  }
}

async function disconnect(ctx: Context) {
  if (!managers(ctx.actor.role)) deny();
  const account = await activeAccount(ctx.db, ctx.actor.workspaceId);
  if (!account) throw new HubError("No Instagram account is connected.", 404);
  await ctx.db.prepare(`UPDATE social_accounts SET status = 'disconnected', token_ciphertext = '', token_iv = '',
    disconnected_by_member_id = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
    .bind(ctx.actor.id, ctx.actor.workspaceId, account.id).run();
  await activity(ctx, "instagram_disconnected", account.id, instagramLabel(account), "Instagram account disconnected. Stored access token removed.");
  return Response.json({ disconnected: true }, { headers: noStoreHeaders });
}

export async function handleMilestoneFive(request: Request, path: string[], ctx: Context): Promise<Response | null> {
  const [resource, platform, action] = path;
  if (resource !== "integrations" || platform !== "instagram") return null;
  if (!action && request.method === "GET") {
    const account = await activeAccount(ctx.db, ctx.actor.workspaceId);
    return Response.json({
      configured: configured(ctx.config),
      account: publicAccount(account),
      permissions: { manage: managers(ctx.actor.role) },
      redirectUri: `${ctx.origin}/api/hub/integrations/instagram/callback`,
      capabilities: ["Single image", "Reel / video"],
    }, { headers: noStoreHeaders });
  }
  if (action === "connect" && request.method === "POST") return beginConnection(ctx);
  if (action === "callback" && request.method === "GET") return finishConnection(request, ctx);
  if (action === "disconnect" && request.method === "POST") return disconnect(ctx);
  return null;
}

async function refreshTokenIfNeeded(ctx: Context, account: SocialAccountRow) {
  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > 7 * 24 * 60 * 60_000) {
    return decryptSocialToken(account.tokenCiphertext, account.tokenIv, ctx.config.encryptionKey);
  }
  const current = await decryptSocialToken(account.tokenCiphertext, account.tokenIv, ctx.config.encryptionKey);
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", current);
  const refreshed = await graphJson<{ access_token: string; expires_in?: number }>(url.toString());
  const encrypted = await encryptSocialToken(refreshed.access_token, ctx.config.encryptionKey);
  const nextExpiry = new Date(Date.now() + Number(refreshed.expires_in ?? 5_184_000) * 1000).toISOString();
  await ctx.db.prepare(`UPDATE social_accounts SET token_ciphertext = ?, token_iv = ?, token_expires_at = ?,
    last_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
    .bind(encrypted.ciphertext, encrypted.iv, nextExpiry, new Date().toISOString(), ctx.actor.workspaceId, account.id).run();
  return refreshed.access_token;
}

async function mediaForJob(ctx: Context, variantId: number, contentId: number) {
  const variantAsset = await ctx.db.prepare(`SELECT m.id, m.kind, m.mime_type AS mimeType
    FROM platform_variant_media_assets link JOIN media_assets m ON m.id = link.media_asset_id
    WHERE link.workspace_id = ? AND link.variant_id = ? AND m.kind IN ('image', 'video')
    ORDER BY CASE link.usage WHEN 'Main Asset' THEN 0 WHEN 'Cover' THEN 1 ELSE 2 END, link.position, link.id LIMIT 1`)
    .bind(ctx.actor.workspaceId, variantId).first<{ id: number; kind: string; mimeType: string }>();
  if (variantAsset) return variantAsset;
  return ctx.db.prepare(`SELECT m.id, m.kind, m.mime_type AS mimeType
    FROM content_media_assets link JOIN media_assets m ON m.id = link.media_asset_id
    WHERE link.workspace_id = ? AND link.content_id = ? AND m.kind IN ('image', 'video')
    ORDER BY CASE link.usage WHEN 'Main Asset' THEN 0 WHEN 'Cover' THEN 1 ELSE 2 END, link.position, link.id LIMIT 1`)
    .bind(ctx.actor.workspaceId, contentId).first<{ id: number; kind: string; mimeType: string }>();
}

function instagramCaption(payload: { caption: string; description: string; hashtags: string; cta: string }) {
  return [payload.caption || payload.description, payload.cta, payload.hashtags].map(value => value.trim()).filter(Boolean).join("\n\n").slice(0, 2200);
}

function connector(ctx: Context): PublishingConnector {
  return { async publish(payload) {
    const row = await ctx.db.prepare(`SELECT a.id, a.workspace_id AS workspaceId, a.provider_account_id AS providerAccountId,
      a.username, a.display_name AS displayName, a.account_type AS accountType, a.profile_picture_url AS profilePictureUrl,
      a.token_ciphertext AS tokenCiphertext, a.token_iv AS tokenIv, a.token_expires_at AS tokenExpiresAt,
      a.scopes, a.status, a.last_verified_at AS lastVerifiedAt, a.last_error_code AS lastErrorCode,
      a.last_error_message AS lastErrorMessage, a.created_at AS createdAt, a.updated_at AS updatedAt,
      j.social_account_id AS jobAccountId, j.provider_container_id AS providerContainerId
      FROM publish_jobs j LEFT JOIN social_accounts a ON a.id = j.social_account_id AND a.workspace_id = j.workspace_id
      WHERE j.workspace_id = ? AND j.id = ?`).bind(ctx.actor.workspaceId, payload.jobId)
      .first<SocialAccountRow & { jobAccountId: number | null; providerContainerId: string }>();
    const account = row?.jobAccountId ? row : await activeAccount(ctx.db, ctx.actor.workspaceId);
    if (!account || account.status !== "connected" || !account.tokenCiphertext || !account.tokenIv) {
      return { ok: false, retryable: false, errorCode: "ACCOUNT_NOT_CONNECTED", errorMessage: "Connect an Instagram professional account before publishing." };
    }
    const asset = await mediaForJob(ctx, payload.variantId, payload.contentId);
    if (!asset) return { ok: false, retryable: false, errorCode: "MEDIA_REQUIRED", errorMessage: "Attach one image or video to the Instagram platform version before publishing." };
    try {
      const token = await refreshTokenIfNeeded(ctx, account);
      const expires = Math.floor(Date.now() / 1000) + 15 * 60;
      const signature = await signPublishingMedia(ctx.actor.workspaceId, asset.id, expires, ctx.config.encryptionKey);
      const mediaUrl = `${ctx.origin}/api/publishing-media/${asset.id}?workspace=${encodeURIComponent(ctx.actor.workspaceId)}&expires=${expires}&signature=${encodeURIComponent(signature)}`;
      let containerId = row && row.id === account.id ? row.providerContainerId : "";
      if (!containerId) {
        const createUrl = new URL(`https://graph.instagram.com/${ctx.config.apiVersion}/${account.providerAccountId}/media`);
        const params = new URLSearchParams({ access_token: token, caption: instagramCaption(payload) });
        if (asset.kind === "video") { params.set("media_type", "REELS"); params.set("video_url", mediaUrl); }
        else params.set("image_url", mediaUrl);
        const created = await graphJson<{ id: string }>(createUrl.toString(), { method: "POST", body: params });
        containerId = created.id;
        await ctx.db.prepare("UPDATE publish_jobs SET provider_container_id = ?, social_account_id = ?, account_label = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
          .bind(containerId, account.id, instagramLabel(account), ctx.actor.workspaceId, payload.jobId).run();
      }
      if (asset.kind === "video") {
        const statusUrl = new URL(`https://graph.instagram.com/${ctx.config.apiVersion}/${containerId}`);
        statusUrl.searchParams.set("fields", "status_code,status");
        statusUrl.searchParams.set("access_token", token);
        const status = await graphJson<{ status_code?: string; status?: string }>(statusUrl.toString());
        if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
          await ctx.db.prepare("UPDATE publish_jobs SET provider_container_id = '' WHERE workspace_id = ? AND id = ?")
            .bind(ctx.actor.workspaceId, payload.jobId).run();
          return { ok: false, retryable: true, errorCode: "MEDIA_PROCESSING_FAILED", errorMessage: status.status || "Instagram could not process this video." };
        }
        if (status.status_code !== "FINISHED") return { ok: false, retryable: true, errorCode: "MEDIA_PROCESSING", errorMessage: "Instagram is still processing the video. Creative Hub will retry automatically." };
      }
      const publishUrl = new URL(`https://graph.instagram.com/${ctx.config.apiVersion}/${account.providerAccountId}/media_publish`);
      const published = await graphJson<{ id: string }>(publishUrl.toString(), { method: "POST", body: new URLSearchParams({ creation_id: containerId, access_token: token }) });
      const permalinkUrl = new URL(`https://graph.instagram.com/${ctx.config.apiVersion}/${published.id}`);
      permalinkUrl.searchParams.set("fields", "id,permalink");
      permalinkUrl.searchParams.set("access_token", token);
      const details = await graphJson<{ id: string; permalink?: string }>(permalinkUrl.toString());
      await ctx.db.prepare("UPDATE social_accounts SET last_verified_at = ?, last_error_code = '', last_error_message = '', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
        .bind(new Date().toISOString(), ctx.actor.workspaceId, account.id).run();
      return { ok: true, externalPostId: details.id || published.id, externalPostUrl: details.permalink };
    } catch (error) {
      if (error instanceof GraphError) {
        const expired = error.code === 190;
        await ctx.db.prepare(`UPDATE social_accounts SET status = ?, last_error_code = ?, last_error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ? AND id = ?`).bind(expired ? "expired" : account.status, String(error.code), error.message.slice(0, 500), ctx.actor.workspaceId, account.id).run();
        return { ok: false, retryable: !expired && error.transient, errorCode: expired ? "AUTHORIZATION_EXPIRED" : `INSTAGRAM_${error.code}`, errorMessage: expired ? "Instagram authorization expired. Reconnect the account and retry this job." : error.message };
      }
      return { ok: false, retryable: true, errorCode: "INSTAGRAM_UNAVAILABLE", errorMessage: "Creative Hub could not reach Instagram. The job will retry automatically." };
    }
  } };
}

export async function createPublishingConnectors(ctx: Context): Promise<PublishingConnectors> {
  if (!configured(ctx.config) || !ctx.bucket || !await activeAccount(ctx.db, ctx.actor.workspaceId)) return {};
  return { Instagram: connector(ctx) };
}
