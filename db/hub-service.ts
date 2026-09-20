import { roles, statuses, priorities, managers, strategists, canCreate, canDelete, canSee, canMove, editableFields, permissionMessage, type Actor, type ContentItem, type Member, type Pillar } from "../lib/hub-types";

type Identity = { userId: string; email: string; displayName: string };
type Context = { db: D1Database; identity: Identity | null; ownerEmail: string };
export class HubError extends Error { constructor(message: string, public status = 400) { super(message); } }
const deny = () => { throw new HubError(permissionMessage, 403); };
const cols = "id, title, publish_date AS publishDate, pillar, pillar_id AS pillarId, campaign, brand, platform, pic, assignee_id AS assigneeId, priority, status, caption, notes, version, review_decision AS reviewDecision";
const memberCols = "id, user_id AS userId, workspace_id AS workspaceId, name, email, role, status";
const text = (value: unknown, max = 200) => {
  if (typeof value !== "string" || value.length > max) throw new HubError("Please enter valid text within the allowed length.");
  return value.trim();
};
const required = (value: unknown, label: string, max = 200) => { const result = text(value, max); if (!result) throw new HubError(`${label} is required.`); return result; };
const idOf = (value: unknown): number => { const id = Number(value); if (!Number.isInteger(id) || id < 1) throw new HubError("Invalid record."); return id; };
const validDate = (value: unknown) => { const s = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new HubError("Choose a valid publish date."); return s; };
async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 50000) throw new HubError("This request is too large.", 413);
  let value; try { const raw = await request.text(); if (raw.length > 50000) throw new Error(); value = JSON.parse(raw); } catch { throw new HubError("Please send a valid form."); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new HubError("Please send a valid form.");
  return value as Record<string, unknown>;
}

async function initialize(db: D1Database, user: Identity, ownerEmail: string) {
  if (!ownerEmail || user.email.toLowerCase() !== ownerEmail.toLowerCase()) return;
  await db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_user_id, owner_email, initialized) VALUES ('main', 'Creative Hub', ?, ?, 0)").bind(user.userId, user.email.toLowerCase()).run();
  const workspace = await db.prepare("SELECT initialized, owner_user_id FROM workspaces WHERE id = 'main'").first<{ initialized: number; owner_user_id: string }>();
  if (!workspace || workspace.owner_user_id !== user.userId) return;
  await db.prepare("INSERT OR IGNORE INTO members (workspace_id, user_id, name, email, role, status) VALUES ('main', ?, ?, ?, 'Owner', 'Active')").bind(user.userId, user.displayName, user.email.toLowerCase()).run();
  if (workspace.initialized) return;
  // Import existing labels once. Never seed or delete content during reads.
  const legacy = await db.prepare("SELECT DISTINCT pillar FROM content_items WHERE workspace_id = 'main' AND pillar != ''").all<{ pillar: string }>();
  const names = [...new Set(["Education", "Productivity", "Product updates", "Behind the scenes", ...legacy.results.map(x => x.pillar)])];
  const commands: D1PreparedStatement[] = names.map((name, index) => db.prepare("INSERT INTO pillars (workspace_id, name, description, objective, color, active, position) SELECT 'main', ?, '', '', ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM pillars WHERE workspace_id = 'main' AND name = ?)").bind(name, ["#2563eb", "#8b5cf6", "#d97706", "#059669"][index % 4], index, name));
  commands.push(db.prepare("UPDATE content_items SET pillar_id = (SELECT id FROM pillars WHERE workspace_id = content_items.workspace_id AND name = content_items.pillar LIMIT 1) WHERE workspace_id = 'main' AND pillar_id IS NULL AND pillar != ''"));
  const legacyCampaigns = await db.prepare("SELECT DISTINCT campaign AS name FROM content_items WHERE workspace_id = 'main' AND campaign != ''").all<{ name: string }>();
  for (const name of new Set(["September reset", "Work smarter", "Meet the team", "Always-on content", ...legacyCampaigns.results.map(x => x.name)])) {
    commands.push(db.prepare("INSERT INTO collections (workspace_id, kind, name, description) SELECT 'main', 'campaign', ?, '' WHERE NOT EXISTS (SELECT 1 FROM collections WHERE workspace_id = 'main' AND kind = 'campaign' AND name = ?)").bind(name, name));
  }
  commands.push(db.prepare("INSERT INTO collections (workspace_id, kind, name, description) SELECT 'main', 'brand', 'Creative Hub', 'Clear, useful, friendly, confident.' WHERE NOT EXISTS (SELECT 1 FROM collections WHERE workspace_id = 'main' AND kind = 'brand' AND name = 'Creative Hub')"));
  commands.push(db.prepare("UPDATE workspaces SET initialized = 1 WHERE id = 'main'"));
  await db.batch(commands);
}

async function authenticate(ctx: Context): Promise<Actor> {
  const user = ctx.identity;
  if (!user) throw new HubError("Please sign in to continue.", 401);
  await initialize(ctx.db, user, ctx.ownerEmail);
  const member = await ctx.db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = 'main' AND email = ?`).bind(user.email.toLowerCase()).first<Actor>();
  if (!member || member.status === "Inactive" || (member.userId && member.userId !== user.userId)) deny();
  const actor = member!;
  if (actor.status === "Invited" || !actor.userId) {
    await ctx.db.prepare("UPDATE members SET user_id = ?, status = 'Active', name = ? WHERE id = ? AND status != 'Inactive' AND (user_id IS NULL OR user_id = ?)").bind(user.userId, user.displayName, actor.id, user.userId).run();
    actor.userId = user.userId; actor.status = "Active"; actor.name = user.displayName;
  }
  return actor;
}

async function getItem(db: D1Database, actor: Actor, id: number) {
  const item = await db.prepare(`SELECT ${cols} FROM content_items WHERE workspace_id = ? AND id = ?`).bind(actor.workspaceId, id).first<ContentItem>();
  if (!item) throw new HubError("Content item not found.", 404);
  if (!canSee(actor, item)) deny();
  return item;
}

async function contentInput(db: D1Database, actor: Actor, payload: Record<string, unknown>, previous?: ContentItem) {
  const allowed = ["title", "publishDate", "pillarId", "campaign", "brand", "platform", "pic", "assigneeId", "priority", "status", "caption", "notes", "version"];
  if (Object.keys(payload).some(x => !allowed.includes(x))) throw new HubError("This form contains an unsupported field.");
  const input = { ...previous, ...payload } as unknown as ContentItem;
  input.title = required(input.title, "Content title");
  input.publishDate = validDate(input.publishDate);
  input.brand = required(input.brand, "Brand");
  input.campaign = text(input.campaign ?? "");
  input.platform = required(input.platform, "Platform", 80);
  input.pic = text(input.pic ?? "", 120);
  input.caption = text(input.caption ?? "", 15000);
  input.notes = text(input.notes ?? "", 15000);
  if (!statuses.includes(input.status)) throw new HubError("Choose a valid workflow status.");
  if (!priorities.includes(input.priority)) throw new HubError("Choose a valid priority.");
  input.pillarId = input.pillarId == null ? null : idOf(input.pillarId);
  input.assigneeId = input.assigneeId == null ? null : idOf(input.assigneeId);
  if (!previous && actor.role === "Creative") { input.assigneeId = actor.id; input.pic = actor.name; }
  // Permission checks precede metadata lookups and apply even when the client sends a full form.
  if (previous) {
    const fields = editableFields(actor, previous);
    for (const key of allowed.filter(x => !["version", "status"].includes(x))) {
      if (input[key as keyof ContentItem] !== previous[key as keyof ContentItem] && !fields.includes(key)) deny();
    }
    if (input.status !== previous.status && !canMove(actor, previous, input.status)) deny();
    if (!fields.length && input.status === previous.status) deny();
  } else if (!managers(actor.role) && input.status !== "Idea") deny();
  const brand = await db.prepare("SELECT id FROM collections WHERE workspace_id = ? AND kind = 'brand' AND name = ?").bind(actor.workspaceId, input.brand).first();
  if (!brand) throw new HubError("Choose an existing brand.");
  if (input.campaign && !await db.prepare("SELECT id FROM collections WHERE workspace_id = ? AND kind = 'campaign' AND name = ?").bind(actor.workspaceId, input.campaign).first()) throw new HubError("Choose an existing campaign.");
  input.pillar = "";
  if (input.pillarId != null) {
    const pillar = await db.prepare("SELECT id, name, active FROM pillars WHERE workspace_id = ? AND id = ?").bind(actor.workspaceId, input.pillarId).first<Pillar>();
    if (!pillar || (!pillar.active && previous?.pillarId !== pillar.id)) throw new HubError("Choose an active content pillar.");
    input.pillar = pillar.name;
  }
  if (input.assigneeId != null) {
    const member = await db.prepare("SELECT id, name, status FROM members WHERE workspace_id = ? AND id = ?").bind(actor.workspaceId, input.assigneeId).first<Member>();
    if (!member || (member.status === "Inactive" && previous?.assigneeId !== member.id)) throw new HubError("Choose an active team member.");
    input.pic = member.name;
  }
  return input;
}

function ensureVersion(payload: Record<string, unknown>, item: ContentItem) {
  if (!Number.isInteger(payload.version) || payload.version !== item.version) throw new HubError("This item changed since you opened it. Refresh and try again.", 409);
}

export async function handleHub(request: Request, path: string[], ctx: Context): Promise<Response> {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new HubError("Please make changes from your Creative Hub workspace.", 403);
    }
    const actor = await authenticate(ctx); const db = ctx.db; const scope = actor.workspaceId;
    const [resource, key, action] = path; const method = request.method;
    if (resource === "workspace" && method === "GET") {
      const [workspace, content, pillars, members, collections] = await Promise.all([
        db.prepare("SELECT id, name FROM workspaces WHERE id = ?").bind(scope).first(),
        db.prepare(`SELECT ${cols} FROM content_items WHERE workspace_id = ? ${actor.role === "Designer" ? "AND assignee_id = ?" : ""} ORDER BY publish_date, id`).bind(...(actor.role === "Designer" ? [scope, actor.id] : [scope])).all(),
        db.prepare("SELECT p.*, (SELECT COUNT(*) FROM content_items c WHERE c.workspace_id = p.workspace_id AND c.pillar_id = p.id) AS usage FROM pillars p WHERE p.workspace_id = ? ORDER BY position, id").bind(scope).all(),
        db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = ? ORDER BY CASE WHEN role = 'Owner' THEN 0 ELSE 1 END, name`).bind(scope).all<Member>(),
        db.prepare("SELECT id, kind, name, description FROM collections WHERE workspace_id = ? ORDER BY id").bind(scope).all(),
      ]);
      return json({ actor, workspace, items: content.results, pillars: pillars.results, members: managers(actor.role) ? members.results : members.results.filter(x => x.status !== "Inactive").map(x => ({ id: x.id, name: x.name, status: x.status, role: x.role })), collections: collections.results });
    }
    if (resource === "workspace" && method === "PATCH") {
      if (actor.role !== "Owner") deny(); const input = await body(request);
      await db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(required(input.name, "Workspace name", 100), scope).run();
      return json({ saved: true });
    }
    if (resource === "content") {
      if (method === "GET" && key) return json({ item: await getItem(db, actor, idOf(key)) });
      if (method === "GET") {
        const result = await db.prepare(`SELECT ${cols} FROM content_items WHERE workspace_id = ? ${actor.role === "Designer" ? "AND assignee_id = ?" : ""} ORDER BY publish_date, id`).bind(...(actor.role === "Designer" ? [scope, actor.id] : [scope])).all();
        return json({ items: result.results });
      }
      if (method === "POST" && !key) {
        if (!canCreate(actor.role)) deny();
        const input = await contentInput(db, actor, await body(request));
        const result = await db.prepare("INSERT INTO content_items (owner_id, workspace_id, title, publish_date, pillar, pillar_id, campaign, brand, platform, pic, assignee_id, priority, status, caption, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(actor.userId, scope, input.title, input.publishDate, input.pillar, input.pillarId, input.campaign, input.brand, input.platform, input.pic, input.assigneeId, input.priority, input.status, input.caption, input.notes).run();
        return json({ item: await getItem(db, actor, Number(result.meta.last_row_id)) }, 201);
      }
      if (key) {
        const item = await getItem(db, actor, idOf(key));
        if (method === "DELETE") {
          if (!canDelete(actor.role)) deny();
          const input = await body(request); ensureVersion(input, item);
          const result = await db.prepare("DELETE FROM content_items WHERE workspace_id = ? AND id = ? AND version = ?").bind(scope, item.id, item.version).run();
          changed(result); return json({ deleted: true });
        }
        if (method === "PATCH" && action === "status") {
          const input = await body(request); ensureVersion(input, item);
          const target = input.status as ContentItem["status"];
          if (!statuses.includes(target)) throw new HubError("Choose a valid workflow status.");
          if (target === item.status || !canMove(actor, item, target)) deny();
          const decision = input.decision === "rejected" ? "rejected" : target === "Approved" ? "approved" : target === "Revision" ? "revision" : "";
          if (input.decision && input.decision !== "rejected") throw new HubError("Invalid review decision.");
          if (decision === "rejected" && (!(["Owner", "Admin", "Approver"].includes(actor.role)) || item.status !== "Review" || target !== "Revision")) deny();
          const result = await db.prepare("UPDATE content_items SET status = ?, review_decision = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?").bind(target, decision, scope, item.id, item.version).run();
          changed(result); return json({ item: await getItem(db, actor, item.id) });
        }
        if (method === "PUT" && !action) {
          const input = await body(request); ensureVersion(input, item);
          const next = await contentInput(db, actor, input, item);
          const result = await db.prepare("UPDATE content_items SET title = ?, publish_date = ?, pillar = ?, pillar_id = ?, campaign = ?, brand = ?, platform = ?, pic = ?, assignee_id = ?, priority = ?, status = ?, caption = ?, notes = ?, review_decision = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?").bind(next.title, next.publishDate, next.pillar, next.pillarId, next.campaign, next.brand, next.platform, next.pic, next.assigneeId, next.priority, next.status, next.caption, next.notes, next.status !== item.status ? (next.status === "Approved" ? "approved" : next.status === "Revision" ? "revision" : "") : item.reviewDecision, scope, item.id, item.version).run();
          changed(result); return json({ item: await getItem(db, actor, item.id) });
        }
      }
    }
    if (resource === "pillars") {
      if (!strategists(actor.role)) deny();
      if (key === "reorder" && method === "PATCH") {
        const input = await body(request); const ids = input.ids;
        const all = await db.prepare("SELECT id FROM pillars WHERE workspace_id = ?").bind(scope).all<{ id: number }>();
        if (!Array.isArray(ids) || ids.length !== all.results.length || new Set(ids).size !== ids.length || !ids.every(id => all.results.some(x => x.id === id))) throw new HubError("Refresh the pillar list before reordering.", 409);
        if (ids.length) await db.batch(ids.map((id, index) => db.prepare("UPDATE pillars SET position = ? WHERE workspace_id = ? AND id = ?").bind(index, scope, id)));
        return json({ saved: true });
      }
      const pillar = key ? await db.prepare("SELECT * FROM pillars WHERE workspace_id = ? AND id = ?").bind(scope, idOf(key)).first<Pillar>() : null;
      if (key && !pillar) throw new HubError("Content pillar not found.", 404);
      if (method === "DELETE" && pillar) {
        const input = await body(request); if (input.confirm !== true) throw new HubError("Confirm deletion. Existing content will be kept without this pillar.");
        await db.batch([
          db.prepare("UPDATE content_items SET pillar_id = NULL, pillar = '', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND pillar_id = ?").bind(scope, pillar.id),
          db.prepare("DELETE FROM pillars WHERE workspace_id = ? AND id = ?").bind(scope, pillar.id),
        ]);
        return json({ deleted: true });
      }
      if (method === "POST" && !key || method === "PUT" && pillar) {
        const input = await body(request); const name = required(input.name, "Pillar name", 100);
        const description = text(input.description ?? "", 2000); const objective = text(input.objective ?? "", 1000);
        const color = text(input.color, 7); if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HubError("Choose a valid color.");
        if (typeof input.active !== "boolean") throw new HubError("Choose an active or inactive status.");
        const duplicate = await db.prepare("SELECT id FROM pillars WHERE workspace_id = ? AND lower(name) = lower(?) AND id != ?").bind(scope, name, pillar?.id ?? 0).first();
        if (duplicate) throw new HubError("A pillar with this name already exists.", 409);
        if (pillar) await db.batch([
          db.prepare("UPDATE pillars SET name = ?, description = ?, objective = ?, color = ?, active = ? WHERE workspace_id = ? AND id = ?").bind(name, description, objective, color, input.active ? 1 : 0, scope, pillar.id),
          db.prepare("UPDATE content_items SET pillar = ?, version = version + 1 WHERE workspace_id = ? AND pillar_id = ?").bind(name, scope, pillar.id),
        ]);
        else await db.prepare("INSERT INTO pillars (workspace_id, name, description, objective, color, active, position) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM pillars WHERE workspace_id = ?))").bind(scope, name, description, objective, color, input.active ? 1 : 0, scope).run();
        return json({ saved: true }, pillar ? 200 : 201);
      }
    }
    if (resource === "members") {
      if (!managers(actor.role)) deny();
      if (method === "POST" && !key) {
        const input = await body(request); const email = required(input.email, "Email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HubError("Enter a valid email address.");
        if (!roles.includes(input.role as Member["role"]) || input.role === "Owner") deny();
        if (await db.prepare("SELECT id FROM members WHERE email = ?").bind(email).first()) throw new HubError("This member already exists.", 409);
        await db.prepare("INSERT INTO members (workspace_id, name, email, role, status) VALUES (?, ?, ?, ?, 'Invited')").bind(scope, required(input.name, "Name", 120), email, input.role).run();
        return json({ saved: true }, 201);
      }
      if (method === "PATCH" && key) {
        const target = await db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = ? AND id = ?`).bind(scope, idOf(key)).first<Member>();
        if (!target) throw new HubError("Member not found.", 404);
        const input = await body(request);
        if (target.role === "Owner" || target.id === actor.id || input.role === "Owner") deny();
        const role = input.role ?? target.role; const status = input.status ?? target.status;
        if (!roles.includes(role as Member["role"]) || !["Active", "Invited", "Inactive"].includes(String(status))) throw new HubError("Choose a valid role and status.");
        if (status === "Active" && !target.userId) throw new HubError("This member must sign in before becoming active.");
        await db.prepare("UPDATE members SET role = ?, status = ? WHERE workspace_id = ? AND id = ? AND role != 'Owner'").bind(role, status, scope, target.id).run();
        return json({ saved: true });
      }
      // Members are disabled, never deleted; assignments and attribution are retained.
    }
    if (resource === "collections") {
      const input = await body(request); const kind = input.kind;
      if (kind !== "brand" && kind !== "campaign") throw new HubError("Choose brand or campaign.");
      if (kind === "brand" ? !managers(actor.role) : !strategists(actor.role)) deny();
      const name = required(input.name, "Name", 100); const description = text(input.description ?? "", 2000);
      if (await db.prepare("SELECT id FROM collections WHERE workspace_id = ? AND kind = ? AND lower(name) = lower(?) AND id != ?").bind(scope, kind, name, key ? idOf(key) : 0).first()) throw new HubError("This name already exists.", 409);
      if (method === "POST" && !key) { await db.prepare("INSERT INTO collections (workspace_id, kind, name, description) VALUES (?, ?, ?, ?)").bind(scope, kind, name, description).run(); return json({ saved: true }, 201); }
      if (method === "PUT" && key) {
        const old = await db.prepare("SELECT name FROM collections WHERE workspace_id = ? AND kind = ? AND id = ?").bind(scope, kind, idOf(key)).first<{ name: string }>();
        if (!old) throw new HubError("Record not found.", 404);
        await db.batch([
          db.prepare("UPDATE collections SET name = ?, description = ? WHERE workspace_id = ? AND kind = ? AND id = ?").bind(name, description, scope, kind, idOf(key)),
          db.prepare(`UPDATE content_items SET ${kind === "brand" ? "brand" : "campaign"} = ?, version = version + 1 WHERE workspace_id = ? AND ${kind === "brand" ? "brand" : "campaign"} = ?`).bind(name, scope, old.name),
        ]); return json({ saved: true });
      }
    }
    throw new HubError("This action is not available.", 404);
  } catch (error) {
    if (error instanceof HubError) return json({ error: error.message }, error.status);
    console.error("Creative Hub request failed", error);
    return json({ error: "We could not save or load your workspace. Your changes are still in the form. Please try again." }, 500);
  }
}
function changed(result: D1Result) { if (!result.meta.changes) throw new HubError("This item changed. Refresh and try again.", 409); }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
