import {
  canManagePublishing, publishJobStatuses, variantPlatforms,
  type Actor, type ContentItem, type PublishJob, type PublishJobStatus, type PublishLog,
} from "../lib/hub-types.ts";
import { HubError } from "./hub-error.ts";

type Context = { db: D1Database; actor: Actor; connectors?: PublishingConnectors };
type PublishPayload = {
  jobId: number; contentId: number; contentTitle: string; variantId: number; platform: string;
  title: string; caption: string; description: string; hashtags: string; cta: string;
};
export type PublishingConnectorResult =
  | { ok: true; externalPostId: string; externalPostUrl?: string }
  | { ok: false; retryable: boolean; errorCode: string; errorMessage: string };
export type PublishingConnector = { publish(payload: PublishPayload): Promise<PublishingConnectorResult> };
export type PublishingConnectors = Partial<Record<string, PublishingConnector>>;

const jobCols = `j.id, j.workspace_id AS workspaceId, j.content_id AS contentId, c.title AS contentTitle,
  j.variant_id AS variantId, COALESCE(NULLIF(v.title, ''), c.title) AS variantTitle, j.platform,
  j.social_account_id AS socialAccountId, j.account_label AS accountLabel, j.scheduled_at AS scheduledAt, j.status, j.attempt_count AS attemptCount,
  j.max_attempts AS maxAttempts, j.next_attempt_at AS nextAttemptAt, j.last_error_code AS lastErrorCode,
  j.last_error_message AS lastErrorMessage, j.created_by_member_id AS createdByMemberId,
  COALESCE(m.name, 'Former member') AS createdByName, j.external_post_id AS externalPostId,
  j.external_post_url AS externalPostUrl, j.completed_at AS completedAt,
  j.created_at AS createdAt, j.updated_at AS updatedAt`;
const jobFrom = `publish_jobs j
  JOIN content_items c ON c.id = j.content_id AND c.workspace_id = j.workspace_id
  JOIN content_platform_variants v ON v.id = j.variant_id AND v.workspace_id = j.workspace_id
  LEFT JOIN members m ON m.id = j.created_by_member_id AND m.workspace_id = j.workspace_id`;
const logCols = `l.id, l.publish_job_id AS publishJobId, l.content_id AS contentId,
  c.title AS contentTitle, l.variant_id AS variantId, l.platform, l.account_label AS accountLabel,
  l.attempt_number AS attemptNumber, l.request_at AS requestAt, l.response_at AS responseAt,
  l.status, l.external_post_id AS externalPostId, l.external_post_url AS externalPostUrl,
  l.error_code AS errorCode, l.error_message AS errorMessage, l.created_at AS createdAt`;

const deny = (): never => { throw new HubError("You do not have permission to perform this action.", 403); };
const idOf = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HubError("Invalid record.");
  return id;
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) throw new HubError("This request is too large.", 413);
  try {
    const raw = await request.text();
    if (raw.length > 20_000) throw new Error();
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HubError("Please send a valid form."); }
}
function scheduleTime(value: unknown) {
  if (typeof value !== "string" || value.length > 40) throw new HubError("Choose a valid publishing date and time.");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HubError("Choose a valid publishing date and time.");
  return parsed.toISOString();
}
async function activity(ctx: Context, action: string, entityId: string | number, title: string, summary: string, context: Record<string, unknown> = {}) {
  await ctx.db.prepare(`INSERT INTO activity_history
    (workspace_id, actor_member_id, actor_name, action, entity_type, entity_id, entity_title, summary, context)
    VALUES (?, ?, ?, ?, 'publishing', ?, ?, ?, ?)`)
    .bind(ctx.actor.workspaceId, ctx.actor.id, ctx.actor.name, action, String(entityId), title, summary, JSON.stringify(context).slice(0, 8000)).run();
}
async function loadJob(ctx: Context, id: number) {
  const job = await ctx.db.prepare(`SELECT ${jobCols} FROM ${jobFrom} WHERE j.workspace_id = ? AND j.id = ?`)
    .bind(ctx.actor.workspaceId, id).first<PublishJob>();
  if (!job) throw new HubError("Publishing job not found.", 404);
  return job;
}
async function loadSchedulable(ctx: Context, variantId: number) {
  const row = await ctx.db.prepare(`SELECT v.id AS variantId, v.platform, v.caption, v.description, c.id, c.title, c.status,
    c.assignee_id AS assigneeId, c.version
    FROM content_platform_variants v JOIN content_items c ON c.id = v.content_id AND c.workspace_id = v.workspace_id
    WHERE v.workspace_id = ? AND v.id = ?`).bind(ctx.actor.workspaceId, variantId)
    .first<{ variantId: number; platform: string; caption: string; description: string; id: number; title: string; status: ContentItem["status"]; assigneeId: number | null; version: number }>();
  if (!row) throw new HubError("Platform version not found.", 404);
  if (ctx.actor.role === "Designer" && row.assigneeId !== ctx.actor.id) deny();
  if (!canManagePublishing(ctx.actor.role)) deny();
  if (!["Approved", "Scheduled"].includes(row.status)) throw new HubError("Approve this content before scheduling it.", 409);
  const approved = await ctx.db.prepare("SELECT id FROM approvals WHERE workspace_id = ? AND content_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1")
    .bind(ctx.actor.workspaceId, row.id).first();
  if (!approved) throw new HubError("An approved review is required before publishing can be scheduled.", 409);
  return row;
}

async function schedulableMedia(ctx: Context, variantId: number, contentId: number) {
  const platformAsset = await ctx.db.prepare(`SELECT m.id, m.kind, m.mime_type AS mimeType
    FROM platform_variant_media_assets link JOIN media_assets m ON m.id = link.media_asset_id
    WHERE link.workspace_id = ? AND link.variant_id = ? AND m.kind IN ('image', 'video')
    ORDER BY CASE link.usage WHEN 'Main Asset' THEN 0 WHEN 'Cover' THEN 1 ELSE 2 END, link.position, link.id LIMIT 1`)
    .bind(ctx.actor.workspaceId, variantId).first<{ id: number; kind: string; mimeType: string }>();
  if (platformAsset) return platformAsset;
  return ctx.db.prepare(`SELECT m.id, m.kind, m.mime_type AS mimeType
    FROM content_media_assets link JOIN media_assets m ON m.id = link.media_asset_id
    WHERE link.workspace_id = ? AND link.content_id = ? AND m.kind IN ('image', 'video')
    ORDER BY CASE link.usage WHEN 'Main Asset' THEN 0 WHEN 'Cover' THEN 1 ELSE 2 END, link.position, link.id LIMIT 1`)
    .bind(ctx.actor.workspaceId, contentId).first<{ id: number; kind: string; mimeType: string }>();
}

async function listJobs(request: Request, ctx: Context) {
  const params = new URL(request.url).searchParams;
  const state = params.get("status") ?? "";
  if (state && !publishJobStatuses.includes(state as PublishJobStatus)) throw new HubError("Choose a valid publishing status.");
  const where = ["j.workspace_id = ?"];
  const values: unknown[] = [ctx.actor.workspaceId];
  if (state) { where.push("j.status = ?"); values.push(state); }
  if (ctx.actor.role === "Designer") { where.push("c.assignee_id = ?"); values.push(ctx.actor.id); }
  const rows = await ctx.db.prepare(`SELECT ${jobCols} FROM ${jobFrom}
    WHERE ${where.join(" AND ")} ORDER BY
      CASE j.status WHEN 'blocked' THEN 0 WHEN 'failed' THEN 1 WHEN 'processing' THEN 2 WHEN 'retrying' THEN 3 WHEN 'queued' THEN 4 WHEN 'scheduled' THEN 5 ELSE 6 END,
      j.scheduled_at, j.id DESC LIMIT 250`).bind(...values).all<PublishJob>();
  const counts = await ctx.db.prepare(`SELECT status, COUNT(*) AS count FROM publish_jobs WHERE workspace_id = ? GROUP BY status`)
    .bind(ctx.actor.workspaceId).all<{ status: string; count: number }>();
  return { jobs: rows.results, counts: Object.fromEntries(counts.results.map(row => [row.status, Number(row.count)])), permissions: { manage: canManagePublishing(ctx.actor.role), run: canManagePublishing(ctx.actor.role) } };
}

async function createJob(request: Request, ctx: Context) {
  if (!canManagePublishing(ctx.actor.role)) deny();
  const input = await jsonBody(request);
  const variant = await loadSchedulable(ctx, idOf(input.variantId));
  if (!variantPlatforms.includes(variant.platform as typeof variantPlatforms[number])) throw new HubError("This platform is not supported by the publishing queue.");
  const scheduledAt = scheduleTime(input.scheduledAt);
  const duplicate = await ctx.db.prepare(`SELECT id FROM publish_jobs WHERE workspace_id = ? AND variant_id = ?
    AND status IN ('scheduled', 'queued', 'processing', 'retrying', 'blocked')`).bind(ctx.actor.workspaceId, variant.variantId).first();
  if (duplicate) throw new HubError("This platform version already has an active publishing job.", 409);
  const account = variant.platform === "Instagram" ? await ctx.db.prepare(`SELECT id, username, display_name AS displayName
    FROM social_accounts WHERE workspace_id = ? AND platform = 'Instagram' AND status = 'connected'
    ORDER BY updated_at DESC, id DESC LIMIT 1`).bind(ctx.actor.workspaceId)
    .first<{ id: number; username: string; displayName: string }>() : null;
  if (variant.platform === "Instagram") {
    if (!account) throw new HubError("Connect an Instagram professional account before scheduling this post.", 409);
    if (!(variant.caption || variant.description).trim()) throw new HubError("Add the Instagram caption before scheduling this post.", 409);
    const media = await schedulableMedia(ctx, variant.variantId, variant.id);
    if (!media) throw new HubError("Attach one Instagram image or video before scheduling this post.", 409);
    const compatible = media.kind === "image" ? media.mimeType === "image/jpeg" : ["video/mp4", "video/quicktime"].includes(media.mimeType);
    if (!compatible) throw new HubError("Instagram scheduling currently supports JPEG images and MP4 or MOV videos.", 409);
  }
  const accountLabel = account ? account.username ? `@${account.username}` : account.displayName || "Instagram account" : "Not connected";
  const result = await ctx.db.prepare(`INSERT INTO publish_jobs
    (workspace_id, content_id, variant_id, platform, social_account_id, account_label, scheduled_at, status, next_attempt_at, created_by_member_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`)
    .bind(ctx.actor.workspaceId, variant.id, variant.variantId, variant.platform, account?.id ?? null, accountLabel, scheduledAt, scheduledAt, ctx.actor.id).run();
  const jobId = Number(result.meta.last_row_id);
  if (variant.status === "Approved") {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE content_items SET status = 'Scheduled', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?")
        .bind(ctx.actor.workspaceId, variant.id, variant.version),
      ctx.db.prepare(`INSERT INTO content_status_history
        (workspace_id, content_id, from_status, to_status, actor_member_id, actor_name, note)
        VALUES (?, ?, 'Approved', 'Scheduled', ?, ?, 'Publishing job scheduled.')`)
        .bind(ctx.actor.workspaceId, variant.id, ctx.actor.id, ctx.actor.name),
    ]);
  }
  await activity(ctx, "publish_scheduled", jobId, variant.title, `${variant.platform} publishing job scheduled.`, { contentId: variant.id, variantId: variant.variantId, scheduledAt });
  return json({ job: await loadJob(ctx, jobId) }, 201);
}

async function rescheduleJob(request: Request, ctx: Context, job: PublishJob) {
  if (!canManagePublishing(ctx.actor.role)) deny();
  if (!["scheduled", "queued", "retrying", "blocked"].includes(job.status)) throw new HubError("Only an active waiting job can be rescheduled.", 409);
  const scheduledAt = scheduleTime((await jsonBody(request)).scheduledAt);
  await ctx.db.prepare(`UPDATE publish_jobs SET scheduled_at = ?, next_attempt_at = ?, status = 'scheduled', attempt_count = 0,
    locked_at = '', last_error_code = '', last_error_message = '', updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = ? AND id = ?`).bind(scheduledAt, scheduledAt, ctx.actor.workspaceId, job.id).run();
  await activity(ctx, "publish_rescheduled", job.id, job.contentTitle, `${job.platform} publishing job rescheduled.`, { scheduledAt });
  return json({ job: await loadJob(ctx, job.id) });
}

async function cancelJob(ctx: Context, job: PublishJob) {
  if (!canManagePublishing(ctx.actor.role)) deny();
  if (!["scheduled", "queued", "retrying", "blocked"].includes(job.status)) throw new HubError("This publishing job can no longer be cancelled.", 409);
  await ctx.db.prepare(`UPDATE publish_jobs SET status = 'cancelled', cancelled_by_member_id = ?, completed_at = ?,
    locked_at = '', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
    .bind(ctx.actor.id, new Date().toISOString(), ctx.actor.workspaceId, job.id).run();
  await activity(ctx, "publish_cancelled", job.id, job.contentTitle, `${job.platform} publishing job cancelled.`);
  return json({ job: await loadJob(ctx, job.id) });
}

async function retryJob(ctx: Context, job: PublishJob) {
  if (!canManagePublishing(ctx.actor.role)) deny();
  if (!["failed", "blocked"].includes(job.status)) throw new HubError("Only a failed or blocked job can be retried.", 409);
  const now = new Date().toISOString();
  const account = job.platform === "Instagram" ? await ctx.db.prepare(`SELECT id, username, display_name AS displayName
    FROM social_accounts WHERE workspace_id = ? AND platform = 'Instagram' AND status = 'connected'
    ORDER BY updated_at DESC, id DESC LIMIT 1`).bind(ctx.actor.workspaceId)
    .first<{ id: number; username: string; displayName: string }>() : null;
  const accountLabel = account ? account.username ? `@${account.username}` : account.displayName || "Instagram account" : job.accountLabel;
  await ctx.db.prepare(`UPDATE publish_jobs SET status = 'queued', attempt_count = 0, next_attempt_at = ?, locked_at = '',
    last_error_code = '', last_error_message = '', completed_at = '', social_account_id = COALESCE(?, social_account_id),
    account_label = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
    .bind(now, account?.id ?? null, accountLabel, ctx.actor.workspaceId, job.id).run();
  await activity(ctx, "publish_retried", job.id, job.contentTitle, `${job.platform} publishing job returned to the queue.`);
  return json({ job: await loadJob(ctx, job.id) });
}

async function writeLog(db: D1Database, job: PublishJob, attempt: number, requestAt: string, responseAt: string,
  status: string, result: { externalPostId?: string; externalPostUrl?: string; errorCode?: string; errorMessage?: string }) {
  await db.prepare(`INSERT INTO publish_logs
    (workspace_id, publish_job_id, content_id, variant_id, platform, account_label, attempt_number,
     request_at, response_at, status, external_post_id, external_post_url, error_code, error_message, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`)
    .bind(job.workspaceId, job.id, job.contentId, job.variantId, job.platform, job.accountLabel, attempt,
      requestAt, responseAt, status, result.externalPostId ?? "", result.externalPostUrl ?? "",
      result.errorCode ?? "", result.errorMessage ?? "").run();
}

export async function processDuePublishJobs(db: D1Database, actor: Actor, connectors: PublishingConnectors = {}, now = new Date()) {
  const ctx = { db, actor };
  const nowIso = now.toISOString();
  const due = await db.prepare(`SELECT ${jobCols} FROM ${jobFrom}
    WHERE j.workspace_id = ? AND j.status IN ('scheduled', 'queued', 'retrying')
      AND COALESCE(NULLIF(j.next_attempt_at, ''), j.scheduled_at) <= ?
    ORDER BY COALESCE(NULLIF(j.next_attempt_at, ''), j.scheduled_at), j.id LIMIT 20`)
    .bind(actor.workspaceId, nowIso).all<PublishJob>();
  const outcomes: Array<{ id: number; status: PublishJobStatus }> = [];
  for (const job of due.results) {
    const claim = await db.prepare(`UPDATE publish_jobs SET status = 'processing', locked_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ? AND status IN ('scheduled', 'queued', 'retrying')`)
      .bind(nowIso, actor.workspaceId, job.id).run();
    if (!claim.success || Number(claim.meta.changes ?? 0) !== 1) continue;
    const attempt = job.attemptCount + 1;
    const requestAt = new Date().toISOString();
    const connector = connectors[job.platform];
    if (!connector) {
      const responseAt = new Date().toISOString();
      const errorCode = "CONNECTOR_NOT_CONFIGURED";
      const errorMessage = "No social account connector is connected yet. The job is preserved for Milestone 5.";
      await writeLog(db, job, attempt, requestAt, responseAt, "blocked", { errorCode, errorMessage });
      await db.prepare(`UPDATE publish_jobs SET status = 'blocked', attempt_count = ?, locked_at = '',
        last_error_code = ?, last_error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
        .bind(attempt, errorCode, errorMessage, actor.workspaceId, job.id).run();
      await activity(ctx, "publish_blocked", job.id, job.contentTitle, `${job.platform} publishing job is waiting for a connected account.`, { errorCode });
      outcomes.push({ id: job.id, status: "blocked" });
      continue;
    }
    const variant = await db.prepare(`SELECT v.title, v.caption, v.description, v.hashtags, v.cta
      FROM content_platform_variants v WHERE v.workspace_id = ? AND v.id = ?`).bind(actor.workspaceId, job.variantId)
      .first<{ title: string; caption: string; description: string; hashtags: string; cta: string }>();
    let result: PublishingConnectorResult;
    try {
      result = await connector.publish({ jobId: job.id, contentId: job.contentId, contentTitle: job.contentTitle,
        variantId: job.variantId, platform: job.platform, title: variant?.title ?? job.contentTitle,
        caption: variant?.caption ?? "", description: variant?.description ?? "", hashtags: variant?.hashtags ?? "", cta: variant?.cta ?? "" });
    } catch {
      result = { ok: false, retryable: true, errorCode: "CONNECTOR_UNAVAILABLE", errorMessage: "The publishing connector did not respond." };
    }
    const responseAt = new Date().toISOString();
    if (result.ok) {
      await writeLog(db, job, attempt, requestAt, responseAt, "published", result);
      await db.prepare(`UPDATE publish_jobs SET status = 'published', attempt_count = ?, locked_at = '',
        external_post_id = ?, external_post_url = ?, completed_at = ?, last_error_code = '', last_error_message = '',
        updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
        .bind(attempt, result.externalPostId, result.externalPostUrl ?? "", responseAt, actor.workspaceId, job.id).run();
      await activity(ctx, "publish_succeeded", job.id, job.contentTitle, `${job.platform} content published.`, { externalPostId: result.externalPostId });
      outcomes.push({ id: job.id, status: "published" });
      continue;
    }
    const willRetry = result.retryable && attempt < job.maxAttempts;
    const retryMinutes = [5, 15, 45][Math.min(attempt - 1, 2)];
    const nextAttemptAt = new Date(now.getTime() + retryMinutes * 60_000).toISOString();
    const status: PublishJobStatus = willRetry ? "retrying" : "failed";
    await writeLog(db, job, attempt, requestAt, responseAt, status, result);
    await db.prepare(`UPDATE publish_jobs SET status = ?, attempt_count = ?, next_attempt_at = ?, locked_at = '',
      last_error_code = ?, last_error_message = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`)
      .bind(status, attempt, willRetry ? nextAttemptAt : "", result.errorCode, result.errorMessage,
        willRetry ? "" : responseAt, actor.workspaceId, job.id).run();
    await activity(ctx, willRetry ? "publish_retry_scheduled" : "publish_failed", job.id, job.contentTitle,
      willRetry ? `${job.platform} publishing will retry automatically.` : `${job.platform} publishing failed.`,
      { errorCode: result.errorCode, attempt, nextAttemptAt: willRetry ? nextAttemptAt : "" });
    outcomes.push({ id: job.id, status });
  }
  return outcomes;
}

async function listLogs(request: Request, ctx: Context) {
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || 100), 1), 200);
  if (!Number.isInteger(limit)) throw new HubError("Choose a valid log limit.");
  const where = ["l.workspace_id = ?"];
  const values: unknown[] = [ctx.actor.workspaceId];
  if (ctx.actor.role === "Designer") { where.push("c.assignee_id = ?"); values.push(ctx.actor.id); }
  const rows = await ctx.db.prepare(`SELECT ${logCols} FROM publish_logs l
    JOIN content_items c ON c.id = l.content_id AND c.workspace_id = l.workspace_id
    WHERE ${where.join(" AND ")} ORDER BY l.id DESC LIMIT ?`).bind(...values, limit).all<PublishLog>();
  return json({ logs: rows.results });
}

export async function handleMilestoneFour(request: Request, path: string[], ctx: Context): Promise<Response | null> {
  const [resource, collection, key, action] = path;
  if (resource !== "publishing") return null;
  const method = request.method;
  if (collection === "jobs" && method === "GET" && !key) return json(await listJobs(request, ctx));
  if (collection === "jobs" && method === "POST" && !key) return createJob(request, ctx);
  if (collection === "logs" && method === "GET") return listLogs(request, ctx);
  if (collection === "run" && method === "POST") {
    if (!canManagePublishing(ctx.actor.role)) deny();
    const outcomes = await processDuePublishJobs(ctx.db, ctx.actor, ctx.connectors ?? {});
    return json({ processed: outcomes.length, outcomes });
  }
  if (collection === "jobs" && key && /^\d+$/.test(key) && action) {
    const job = await loadJob(ctx, idOf(key));
    if (action === "reschedule" && method === "PATCH") return rescheduleJob(request, ctx, job);
    if (action === "cancel" && method === "POST") return cancelJob(ctx, job);
    if (action === "retry" && method === "POST") return retryJob(ctx, job);
  }
  return null;
}
