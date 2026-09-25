import {
  canComment, canDecideApproval, canMove, canResolveComment, canSee, canSubmitReview, managers, statuses,
  type Actor, type ApprovalRecord, type Comment, type ContentItem, type StatusHistory,
} from "../lib/hub-types.ts";
import { HubError } from "./hub-error.ts";

type Context = { db: D1Database; actor: Actor };

const itemCols = `c.id, c.workspace_id AS workspaceId, c.title,
  c.brand_id AS brandId, COALESCE(b.name, c.brand) AS brand,
  c.campaign_id AS campaignId, COALESCE(cp.name, c.campaign) AS campaign,
  c.pillar_id AS pillarId, COALESCE(p.name, c.pillar) AS pillar,
  c.objective, c.brief, c.target_audience AS targetAudience, c.key_message AS keyMessage,
  c.content_direction AS contentDirection, c."references" AS "references", c.format,
  c.pic, c.assignee_id AS assigneeId, c.creator_member_id AS creatorMemberId,
  COALESCE(creator.name, '') AS creatorName, c.deadline, c.publish_date AS publishDate,
  c.platform, c.priority, c.status, c.caption, c.copy_hook AS copyHook, c.copy_cta AS copyCta,
  c.copy_notes AS copyNotes, c.notes, c.version, c.review_decision AS reviewDecision,
  c.created_at AS createdAt, c.updated_at AS updatedAt`;
const itemFrom = `content_items c
  LEFT JOIN brands b ON b.id = c.brand_id AND b.workspace_id = c.workspace_id
  LEFT JOIN campaigns cp ON cp.id = c.campaign_id AND cp.workspace_id = c.workspace_id
  LEFT JOIN pillars p ON p.id = c.pillar_id AND p.workspace_id = c.workspace_id
  LEFT JOIN members creator ON creator.id = c.creator_member_id AND creator.workspace_id = c.workspace_id`;
const commentCols = `c.id, c.content_id AS contentId, c.author_member_id AS authorMemberId,
  COALESCE(author.name, 'Former member') AS authorName, c.parent_id AS parentId, c.body, c.resolved,
  c.resolved_by_member_id AS resolvedByMemberId, COALESCE(resolver.name, '') AS resolvedByName,
  c.resolved_at AS resolvedAt, c.created_at AS createdAt, c.updated_at AS updatedAt`;
const approvalCols = `a.id, a.content_id AS contentId, a.requested_by_member_id AS requestedByMemberId,
  COALESCE(requester.name, 'Former member') AS requestedByName, a.requested_at AS requestedAt,
  a.status, a.content_version AS contentVersion, a.submission_note AS submissionNote,
  a.decision_by_member_id AS decisionByMemberId, COALESCE(decider.name, '') AS decisionByName,
  a.decision_note AS decisionNote, a.decided_at AS decidedAt`;

const deny = (): never => { throw new HubError("You do not have permission to perform this action.", 403); };
const idOf = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HubError("Invalid record.");
  return id;
};
function text(value: unknown, max = 200) {
  if (typeof value !== "string" || value.length > max) throw new HubError("Please enter valid text within the allowed length.");
  return value.trim();
}
function required(value: unknown, label: string, max = 200) {
  const result = text(value, max);
  if (!result) throw new HubError(`${label} is required.`);
  return result;
}
async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 50_000) throw new HubError("This request is too large.", 413);
  try {
    const raw = await request.text();
    if (raw.length > 50_000) throw new Error();
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HubError("Please send a valid form."); }
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
async function activity(ctx: Context, action: string, item: ContentItem, summary: string, context: Record<string, unknown> = {}) {
  await ctx.db.prepare(`INSERT INTO activity_history
    (workspace_id, actor_member_id, actor_name, action, entity_type, entity_id, entity_title, summary, context)
    VALUES (?, ?, ?, ?, 'content', ?, ?, ?, ?)`)
    .bind(ctx.actor.workspaceId, ctx.actor.id, ctx.actor.name, action, String(item.id), item.title, summary, JSON.stringify(context).slice(0, 8000)).run();
}
async function loadItem(ctx: Context, id: number) {
  const item = await ctx.db.prepare(`SELECT ${itemCols} FROM ${itemFrom} WHERE c.workspace_id = ? AND c.id = ?`)
    .bind(ctx.actor.workspaceId, id).first<ContentItem>();
  if (!item) throw new HubError("Content item not found.", 404);
  if (!canSee(ctx.actor, item)) deny();
  return item;
}
async function freshItem(ctx: Context, id: number) { return loadItem(ctx, id); }
function ensureVersion(value: unknown, item: ContentItem) {
  if (!Number.isInteger(Number(value))) throw new HubError("A content version is required.");
  if (Number(value) !== item.version) throw new HubError("This content changed in another window. Refresh and try again.", 409);
}
function changed(result: D1Result) {
  if (!result.success || Number(result.meta.changes ?? 0) !== 1) throw new HubError("This content changed in another window. Refresh and try again.", 409);
}
async function addStatusHistory(ctx: Context, item: ContentItem, to: ContentItem["status"], note = "") {
  await ctx.db.prepare(`INSERT INTO content_status_history
    (workspace_id, content_id, from_status, to_status, actor_member_id, actor_name, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.actor.workspaceId, item.id, item.status, to, ctx.actor.id, ctx.actor.name, note).run();
}
async function comments(ctx: Context, contentId: number) {
  const rows = await ctx.db.prepare(`SELECT ${commentCols} FROM comments c
    LEFT JOIN members author ON author.id = c.author_member_id AND author.workspace_id = c.workspace_id
    LEFT JOIN members resolver ON resolver.id = c.resolved_by_member_id AND resolver.workspace_id = c.workspace_id
    WHERE c.workspace_id = ? AND c.content_id = ? ORDER BY c.created_at, c.id`)
    .bind(ctx.actor.workspaceId, contentId).all<Comment>();
  return rows.results;
}
async function approvals(ctx: Context, contentId: number) {
  const rows = await ctx.db.prepare(`SELECT ${approvalCols} FROM approvals a
    LEFT JOIN members requester ON requester.id = a.requested_by_member_id AND requester.workspace_id = a.workspace_id
    LEFT JOIN members decider ON decider.id = a.decision_by_member_id AND decider.workspace_id = a.workspace_id
    WHERE a.workspace_id = ? AND a.content_id = ? ORDER BY a.id DESC`)
    .bind(ctx.actor.workspaceId, contentId).all<ApprovalRecord>();
  return rows.results;
}
async function statusHistory(ctx: Context, contentId: number) {
  const rows = await ctx.db.prepare(`SELECT id, content_id AS contentId, from_status AS fromStatus,
    to_status AS toStatus, actor_member_id AS actorMemberId, actor_name AS actorName, note,
    created_at AS createdAt FROM content_status_history WHERE workspace_id = ? AND content_id = ? ORDER BY id DESC`)
    .bind(ctx.actor.workspaceId, contentId).all<StatusHistory>();
  return rows.results;
}

export async function collaborationSnapshot(ctx: Context, item: ContentItem) {
  const [discussion, reviewHistory, workflowHistory] = await Promise.all([
    comments(ctx, item.id), approvals(ctx, item.id), statusHistory(ctx, item.id),
  ]);
  return {
    comments: discussion,
    approvals: reviewHistory,
    statusHistory: workflowHistory,
    currentApproval: reviewHistory.find(record => record.status === "pending") ?? null,
    permissions: {
      comment: canComment(ctx.actor, item),
      submitReview: canSubmitReview(ctx.actor, item),
      decideApproval: canDecideApproval(ctx.actor, item),
      resolveAllComments: managers(ctx.actor.role) || ctx.actor.role === "Content Strategist" || ctx.actor.role === "Approver",
    },
  };
}

async function submitReview(ctx: Context, item: ContentItem, version: unknown, submissionNote: unknown) {
  ensureVersion(version, item);
  if (!canSubmitReview(ctx.actor, item)) deny();
  const note = text(submissionNote ?? "", 3000);
  if (await ctx.db.prepare("SELECT id FROM approvals WHERE workspace_id = ? AND content_id = ? AND status = 'pending'")
    .bind(ctx.actor.workspaceId, item.id).first()) throw new HubError("This content is already waiting for approval.", 409);
  const result = await ctx.db.prepare(`UPDATE content_items SET status = 'Review', review_decision = '',
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?`)
    .bind(ctx.actor.workspaceId, item.id, item.version).run();
  changed(result);
  await ctx.db.prepare(`INSERT INTO approvals
    (workspace_id, content_id, requested_by_member_id, status, content_version, submission_note)
    VALUES (?, ?, ?, 'pending', ?, ?)`)
    .bind(ctx.actor.workspaceId, item.id, ctx.actor.id, item.version + 1, note).run();
  await addStatusHistory(ctx, item, "Review", note);
  await activity(ctx, "review_requested", item, "Submitted for review.", { from: item.status, to: "Review", note });
  return freshItem(ctx, item.id);
}

async function decideApproval(ctx: Context, item: ContentItem, input: Record<string, unknown>) {
  ensureVersion(input.version, item);
  if (!canDecideApproval(ctx.actor, item)) deny();
  if (item.status !== "Review") throw new HubError("Only content in Review can receive an approval decision.", 409);
  const decision = text(input.decision, 20) as "approved" | "revision" | "rejected";
  if (!["approved", "revision", "rejected"].includes(decision)) throw new HubError("Choose a valid approval decision.");
  const note = text(input.note ?? "", 3000);
  if (decision !== "approved" && !note) throw new HubError("A note is required for revision or rejection.");
  const pending = await ctx.db.prepare("SELECT id FROM approvals WHERE workspace_id = ? AND content_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .bind(ctx.actor.workspaceId, item.id).first<{ id: number }>();
  if (!pending) throw new HubError("No active review request was found.", 409);
  const target: ContentItem["status"] = decision === "approved" ? "Approved" : "Revision";
  const result = await ctx.db.prepare(`UPDATE content_items SET status = ?, review_decision = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?`)
    .bind(target, decision, ctx.actor.workspaceId, item.id, item.version).run();
  changed(result);
  const approvalResult = await ctx.db.prepare(`UPDATE approvals SET status = ?, decision_by_member_id = ?,
    decision_note = ?, decided_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND status = 'pending'`)
    .bind(decision, ctx.actor.id, note, ctx.actor.workspaceId, pending.id).run();
  if (!approvalResult.success || Number(approvalResult.meta.changes ?? 0) !== 1) throw new HubError("This review was already decided. Refresh and try again.", 409);
  const historyNote = decision === "approved" ? note : `${decision === "rejected" ? "Rejected" : "Revision requested"}: ${note}`;
  await addStatusHistory(ctx, item, target, historyNote);
  const action = decision === "approved" ? "content_approved" : decision === "rejected" ? "content_rejected" : "revision_requested";
  const summary = decision === "approved" ? "Approved the content." : decision === "rejected" ? `Rejected the content: ${note}` : `Requested revision: ${note}`;
  await activity(ctx, action, item, summary, { from: item.status, to: target, decision, note, approvalId: pending.id });
  return freshItem(ctx, item.id);
}

async function moveStatus(ctx: Context, item: ContentItem, input: Record<string, unknown>) {
  ensureVersion(input.version, item);
  const target = input.status as ContentItem["status"];
  if (!statuses.includes(target)) throw new HubError("Choose a valid workflow status.");
  if (target === item.status || !canMove(ctx.actor, item, target)) deny();
  if (target === "Review") return submitReview(ctx, item, input.version, input.note ?? "");
  if (target === "Scheduled" && !await hasApprovedReview(ctx, item)) {
    throw new HubError("This content must be approved before it can be scheduled.", 409);
  }
  const nextDecision = target === "Scheduled" ? item.reviewDecision : "";
  const result = await ctx.db.prepare(`UPDATE content_items SET status = ?, review_decision = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?`)
    .bind(target, nextDecision, ctx.actor.workspaceId, item.id, item.version).run();
  changed(result);
  if (item.status === "Review") {
    await ctx.db.prepare(`UPDATE approvals SET status = 'cancelled', decision_by_member_id = ?,
      decision_note = 'Review was cancelled by a workflow status change.', decided_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND content_id = ? AND status = 'pending'`)
      .bind(ctx.actor.id, ctx.actor.workspaceId, item.id).run();
  }
  await addStatusHistory(ctx, item, target);
  await activity(ctx, "status_changed", item, `Moved from ${item.status} to ${target}.`, { from: item.status, to: target });
  return freshItem(ctx, item.id);
}

export async function recordEmbeddedStatusChange(ctx: Context, before: ContentItem, after: ContentItem) {
  if (before.status === after.status) return;
  if (after.status === "Review") {
    await ctx.db.prepare(`INSERT INTO approvals
      (workspace_id, content_id, requested_by_member_id, status, content_version, submission_note)
      VALUES (?, ?, ?, 'pending', ?, '')`)
      .bind(ctx.actor.workspaceId, before.id, ctx.actor.id, after.version).run();
  }
  if (before.status === "Review") {
    await ctx.db.prepare(`UPDATE approvals SET status = 'cancelled', decision_by_member_id = ?,
      decision_note = 'Review was cancelled by a workflow status change.', decided_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND content_id = ? AND status = 'pending'`)
      .bind(ctx.actor.id, ctx.actor.workspaceId, before.id).run();
  }
  await addStatusHistory(ctx, before, after.status);
}

export async function hasApprovedReview(ctx: Context, item: ContentItem) {
  if (item.status !== "Approved") return false;
  return Boolean(await ctx.db.prepare(`SELECT id FROM approvals WHERE workspace_id = ? AND content_id = ?
    AND status = 'approved' AND content_version = ? ORDER BY id DESC LIMIT 1`)
    .bind(ctx.actor.workspaceId, item.id, Math.max(0, item.version - 1)).first());
}

export async function handleMilestoneThree(request: Request, path: string[], ctx: Context): Promise<Response | null> {
  const [resource, key, action, detail] = path;
  const method = request.method;

  if (resource === "approvals" && method === "GET" && !key) {
    const where = ["a.workspace_id = ?"];
    const values: unknown[] = [ctx.actor.workspaceId];
    if (ctx.actor.role === "Designer") { where.push("c.assignee_id = ?"); values.push(ctx.actor.id); }
    const state = text(new URL(request.url).searchParams.get("status") ?? "", 20);
    if (state) {
      if (!["pending", "approved", "revision", "rejected", "cancelled"].includes(state)) throw new HubError("Choose a valid approval status.");
      where.push("a.status = ?"); values.push(state);
    }
    const rows = await ctx.db.prepare(`SELECT ${approvalCols}, c.title AS contentTitle, c.status AS contentStatus
      FROM approvals a JOIN content_items c ON c.id = a.content_id AND c.workspace_id = a.workspace_id
      LEFT JOIN members requester ON requester.id = a.requested_by_member_id AND requester.workspace_id = a.workspace_id
      LEFT JOIN members decider ON decider.id = a.decision_by_member_id AND decider.workspace_id = a.workspace_id
      WHERE ${where.join(" AND ")} ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.id DESC LIMIT 200`)
      .bind(...values).all<ApprovalRecord>();
    return json({ approvals: rows.results, permissions: { decide: ["Owner", "Admin", "Approver"].includes(ctx.actor.role) } });
  }

  if (resource === "content" && key && action === "comments" && method === "POST") {
    const item = await loadItem(ctx, idOf(key));
    if (!canComment(ctx.actor, item)) deny();
    const input = await jsonBody(request);
    const message = required(input.body, "Comment", 5000);
    const parentId = input.parentId == null ? null : idOf(input.parentId);
    if (parentId) {
      const parent = await ctx.db.prepare("SELECT id, parent_id AS parentId FROM comments WHERE workspace_id = ? AND content_id = ? AND id = ?")
        .bind(ctx.actor.workspaceId, item.id, parentId).first<{ id: number; parentId: number | null }>();
      if (!parent) throw new HubError("The comment you are replying to could not be found.", 404);
      if (parent.parentId) throw new HubError("Reply to the main comment to keep the discussion easy to follow.");
    }
    const result = await ctx.db.prepare(`INSERT INTO comments
      (workspace_id, content_id, author_member_id, parent_id, body) VALUES (?, ?, ?, ?, ?)`)
      .bind(ctx.actor.workspaceId, item.id, ctx.actor.id, parentId, message).run();
    await activity(ctx, parentId ? "comment_replied" : "comment_added", item,
      parentId ? "Replied in the discussion." : "Added a discussion comment.", { commentId: Number(result.meta.last_row_id), parentId });
    return json({ comments: await comments(ctx, item.id) }, 201);
  }

  if (resource === "comments" && key && action === "resolve" && method === "PATCH") {
    const comment = await ctx.db.prepare(`SELECT c.id, c.content_id AS contentId, c.author_member_id AS authorMemberId,
      c.parent_id AS parentId, c.resolved FROM comments c WHERE c.workspace_id = ? AND c.id = ?`)
      .bind(ctx.actor.workspaceId, idOf(key)).first<{ id: number; contentId: number; authorMemberId: number | null; parentId: number | null; resolved: number }>();
    if (!comment) throw new HubError("Comment not found.", 404);
    if (comment.parentId) throw new HubError("Resolve the main discussion instead of an individual reply.");
    const item = await loadItem(ctx, comment.contentId);
    if (!canResolveComment(ctx.actor, item, comment.authorMemberId)) deny();
    const input = await jsonBody(request);
    if (typeof input.resolved !== "boolean") throw new HubError("Choose whether this discussion is resolved.");
    await ctx.db.prepare(`UPDATE comments SET resolved = ?, resolved_by_member_id = ?,
      resolved_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE '' END, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`)
      .bind(input.resolved ? 1 : 0, input.resolved ? ctx.actor.id : null, input.resolved ? 1 : 0, ctx.actor.workspaceId, comment.id).run();
    await activity(ctx, input.resolved ? "comment_resolved" : "comment_reopened", item,
      input.resolved ? "Resolved a discussion." : "Reopened a discussion.", { commentId: comment.id });
    return json({ comments: await comments(ctx, item.id) });
  }

  if (resource === "content" && key && action === "approval" && detail === "submit" && method === "POST") {
    const item = await loadItem(ctx, idOf(key));
    const input = await jsonBody(request);
    return json({ item: await submitReview(ctx, item, input.version, input.note ?? "") });
  }
  if (resource === "content" && key && action === "approval" && detail === "decide" && method === "POST") {
    const item = await loadItem(ctx, idOf(key));
    return json({ item: await decideApproval(ctx, item, await jsonBody(request)) });
  }
  if (resource === "content" && key && action === "status" && method === "PATCH") {
    const item = await loadItem(ctx, idOf(key));
    return json({ item: await moveStatus(ctx, item, await jsonBody(request)) });
  }
  return null;
}
