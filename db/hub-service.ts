import {
  campaignStatuses,
  contentFormats,
  roles,
  statuses,
  priorities,
  managers,
  strategists,
  canCreate,
  canDelete,
  canSee,
  canMove,
  editableFields,
  permissionMessage,
  type Actor,
  type Campaign,
  type ContentItem,
  type Member,
  type Pillar,
} from "../lib/hub-types.ts";
import { HubError } from "./hub-error.ts";
import { handleMilestoneTwo } from "./milestone-two.ts";
import { handleMilestoneThree, hasApprovedReview, recordEmbeddedStatusChange } from "./milestone-three.ts";

type Identity = { userId: string; email: string; displayName: string };
type Context = { db: D1Database; bucket?: R2Bucket; identity: Identity | null; ownerEmail: string };
type WorkspaceRow = { id: string; name: string; slug: string; timezone: string; modelVersion: number; ownerUserId: string; ownerEmail: string };
type BrandRow = { id: number; name: string; description: string; slug: string; logo: string; timezone: string; archived: number };
type CampaignRow = { id: number; brand_id: number; name: string; status: string; archived: number };
type PillarRow = { id: number; brand_id: number | null; name: string };

export { HubError } from "./hub-error.ts";

const deny = (): never => { throw new HubError(permissionMessage, 403); };
const memberCols = "id, user_id AS userId, workspace_id AS workspaceId, name, email, role, status";
const itemCols = `c.id, c.workspace_id AS workspaceId, c.title,
  c.brand_id AS brandId, COALESCE(b.name, c.brand) AS brand,
  c.campaign_id AS campaignId, COALESCE(cp.name, c.campaign) AS campaign,
  c.pillar_id AS pillarId, COALESCE(p.name, c.pillar) AS pillar,
  c.objective, c.brief, c.target_audience AS targetAudience, c.key_message AS keyMessage,
  c.content_direction AS contentDirection, c."references" AS "references", c.format,
  c.pic, c.assignee_id AS assigneeId, c.creator_member_id AS creatorMemberId,
  COALESCE(creator.name, '') AS creatorName, c.deadline, c.publish_date AS publishDate,
  c.platform, c.priority, c.status, c.caption, c.copy_hook AS copyHook, c.copy_cta AS copyCta,
  c.copy_notes AS copyNotes, c.notes, c.version,
  c.review_decision AS reviewDecision, c.created_at AS createdAt, c.updated_at AS updatedAt`;
const itemFrom = `content_items c
  LEFT JOIN brands b ON b.id = c.brand_id AND b.workspace_id = c.workspace_id
  LEFT JOIN campaigns cp ON cp.id = c.campaign_id AND cp.workspace_id = c.workspace_id
  LEFT JOIN pillars p ON p.id = c.pillar_id AND p.workspace_id = c.workspace_id
  LEFT JOIN members creator ON creator.id = c.creator_member_id AND creator.workspace_id = c.workspace_id`;

const writeWindows = new Map<string, { started: number; count: number }>();

function text(value: unknown, max = 200) {
  if (typeof value !== "string" || value.length > max) throw new HubError("Please enter valid text within the allowed length.");
  return value.trim();
}

function required(value: unknown, label: string, max = 200) {
  const result = text(value, max);
  if (!result) throw new HubError(`${label} is required.`);
  return result;
}

function idOf(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HubError("Invalid record.");
  return id;
}

function nullableId(value: unknown): number | null {
  return value == null || value === "" ? null : idOf(value);
}

function validDate(value: unknown, label = "date", optional = false) {
  const valueText = text(value ?? "", 10);
  if (optional && !valueText) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText) || !Number.isFinite(Date.parse(valueText)) || new Date(valueText).toISOString().slice(0, 10) !== valueText) {
    throw new HubError(`Choose a valid ${label}.`);
  }
  return valueText;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "workspace";
}

function validTimezone(value: unknown) {
  const zone = required(value, "Timezone", 100);
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); }
  catch { throw new HubError("Choose a valid timezone."); }
  return zone;
}

async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 50000) throw new HubError("This request is too large.", 413);
  let value: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 50000) throw new Error();
    value = JSON.parse(raw);
  } catch { throw new HubError("Please send a valid form."); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new HubError("Please send a valid form.");
  return value as Record<string, unknown>;
}

function mutationAllowed(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin && site !== "same-origin") {
    throw new HubError("Please make changes from your Creative Hub workspace.", 403);
  }
}

function rateLimit(actor: Actor, request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const now = Date.now();
  const key = `${actor.workspaceId}:${actor.userId || actor.email}`;
  const current = writeWindows.get(key);
  if (!current || now - current.started >= 60_000) writeWindows.set(key, { started: now, count: 1 });
  else {
    current.count += 1;
    if (current.count > 240) throw new HubError("Too many changes were sent at once. Wait a minute and try again.", 429);
  }
}

async function activity(db: D1Database, actor: Actor, action: string, entityType: string, entityId: string | number, entityTitle: string, summary: string, context: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO activity_history
    (workspace_id, actor_member_id, actor_name, action, entity_type, entity_id, entity_title, summary, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(actor.workspaceId, actor.id, actor.name, action, entityType, String(entityId), entityTitle, summary, JSON.stringify(context).slice(0, 8000)).run();
}

async function uniqueSlug(db: D1Database, workspaceId: string, table: "brands" | "workspaces", name: string, exceptId?: number | string) {
  const base = slugify(name);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix ? `${base}-${suffix + 1}` : base;
    const sql = table === "brands"
      ? "SELECT id FROM brands WHERE workspace_id = ? AND slug = ? AND id != ?"
      : "SELECT id FROM workspaces WHERE slug = ? AND id != ?";
    const row = table === "brands"
      ? await db.prepare(sql).bind(workspaceId, candidate, exceptId ?? 0).first()
      : await db.prepare(sql).bind(candidate, exceptId ?? "").first();
    if (!row) return candidate;
  }
  throw new HubError("A unique URL label could not be created. Please use a different name.", 409);
}

async function bootstrapOwner(ctx: Context, user: Identity) {
  if (!ctx.ownerEmail || user.email.toLowerCase() !== ctx.ownerEmail.toLowerCase()) return null;
  let workspace = await ctx.db.prepare("SELECT id FROM workspaces WHERE owner_user_id = ? OR lower(owner_email) = lower(?) ORDER BY id LIMIT 1")
    .bind(user.userId, user.email).first<{ id: string }>();
  if (!workspace) {
    const legacy = await ctx.db.prepare("SELECT workspace_id AS id FROM content_items ORDER BY id LIMIT 1").first<{ id: string }>();
    const id = legacy?.id || `ws-${crypto.randomUUID()}`;
    const slug = await uniqueSlug(ctx.db, id, "workspaces", "Creative Hub", id);
    await ctx.db.prepare(`INSERT INTO workspaces
      (id, name, slug, timezone, owner_user_id, owner_email, initialized, model_version, created_at, updated_at)
      VALUES (?, 'Creative Hub', ?, 'Asia/Jakarta', ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(id, slug, user.userId, user.email.toLowerCase()).run();
    workspace = { id };
  }
  await ctx.db.prepare(`INSERT OR IGNORE INTO members
    (workspace_id, user_id, name, email, role, status) VALUES (?, ?, ?, ?, 'Owner', 'Active')`)
    .bind(workspace.id, user.userId, user.displayName, user.email.toLowerCase()).run();
  return ctx.db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = ? AND lower(email) = lower(?)`)
    .bind(workspace.id, user.email).first<Actor>();
}

async function ensureWorkspaceModel(db: D1Database, actor: Actor) {
  const workspace = await db.prepare(`SELECT id, name, slug, timezone, model_version AS modelVersion,
    owner_user_id AS ownerUserId, owner_email AS ownerEmail FROM workspaces WHERE id = ?`)
    .bind(actor.workspaceId).first<WorkspaceRow>();
  if (!workspace) return;

  if (workspace.modelVersion < 2) {

  const workspaceSlug = workspace.slug || await uniqueSlug(db, workspace.id, "workspaces", workspace.name, workspace.id);
  await db.prepare(`UPDATE workspaces SET slug = ?, timezone = CASE WHEN timezone = '' THEN 'Asia/Jakarta' ELSE timezone END,
    created_at = CASE WHEN created_at = '' THEN CURRENT_TIMESTAMP ELSE created_at END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(workspaceSlug, workspace.id).run();

  const legacyCollections = await db.prepare("SELECT kind, name, description FROM collections WHERE workspace_id = ? ORDER BY id").bind(workspace.id).all<{ kind: string; name: string; description: string }>();
  const legacyContentBrands = await db.prepare("SELECT DISTINCT brand AS name FROM content_items WHERE workspace_id = ? AND brand != ''").bind(workspace.id).all<{ name: string }>();
  const brandSeeds = [
    ...legacyCollections.results.filter(x => x.kind === "brand"),
    ...legacyContentBrands.results.map(x => ({ kind: "brand", name: x.name, description: "" })),
  ];
  if (!brandSeeds.length) brandSeeds.push({ kind: "brand", name: "Creative Hub", description: "" });
  for (const seed of brandSeeds) {
    if (await db.prepare("SELECT id FROM brands WHERE workspace_id = ? AND lower(name) = lower(?)").bind(workspace.id, seed.name).first()) continue;
    const slug = await uniqueSlug(db, workspace.id, "brands", seed.name);
    await db.prepare(`INSERT INTO brands (workspace_id, name, description, slug, timezone)
      VALUES (?, ?, ?, ?, ?)`).bind(workspace.id, seed.name, seed.description || "", slug, workspace.timezone || "Asia/Jakarta").run();
  }
  const brands = await db.prepare("SELECT id, name FROM brands WHERE workspace_id = ? ORDER BY id").bind(workspace.id).all<{ id: number; name: string }>();
  const defaultBrand = brands.results.find(x => x.name.toLowerCase() === "creative hub") ?? brands.results[0];
  if (!defaultBrand) throw new HubError("The workspace could not prepare its Brand records.", 500);

  const legacyPillars = await db.prepare("SELECT DISTINCT pillar AS name FROM content_items WHERE workspace_id = ? AND pillar != ''").bind(workspace.id).all<{ name: string }>();
  for (const [position, row] of legacyPillars.results.entries()) {
    if (!await db.prepare("SELECT id FROM pillars WHERE workspace_id = ? AND lower(name) = lower(?)").bind(workspace.id, row.name).first()) {
      await db.prepare(`INSERT INTO pillars (workspace_id, brand_id, name, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(workspace.id, defaultBrand.id, row.name, position).run();
    }
  }
  await db.prepare(`UPDATE pillars SET brand_id = COALESCE(brand_id, ?),
    created_at = CASE WHEN created_at = '' THEN CURRENT_TIMESTAMP ELSE created_at END,
    updated_at = CASE WHEN updated_at = '' THEN CURRENT_TIMESTAMP ELSE updated_at END
    WHERE workspace_id = ?`).bind(defaultBrand.id, workspace.id).run();
  await db.prepare(`UPDATE content_items SET pillar_id = (
    SELECT p.id FROM pillars p WHERE p.workspace_id = content_items.workspace_id
      AND lower(p.name) = lower(content_items.pillar) LIMIT 1
    ) WHERE workspace_id = ? AND pillar_id IS NULL AND pillar != ''`).bind(workspace.id).run();

  const campaignSeeds = legacyCollections.results.filter(x => x.kind === "campaign");
  const contentCampaigns = await db.prepare("SELECT DISTINCT campaign AS name FROM content_items WHERE workspace_id = ? AND campaign != ''").bind(workspace.id).all<{ name: string }>();
  for (const seed of [...campaignSeeds, ...contentCampaigns.results.map(x => ({ kind: "campaign", name: x.name, description: "" }))]) {
    if (!await db.prepare("SELECT id FROM campaigns WHERE workspace_id = ? AND brand_id = ? AND lower(name) = lower(?)").bind(workspace.id, defaultBrand.id, seed.name).first()) {
      await db.prepare(`INSERT INTO campaigns (workspace_id, brand_id, name, description, status)
        VALUES (?, ?, ?, ?, 'Draft')`).bind(workspace.id, defaultBrand.id, seed.name, seed.description || "").run();
    }
  }

  const content = await db.prepare("SELECT id, brand, campaign FROM content_items WHERE workspace_id = ?").bind(workspace.id).all<{ id: number; brand: string; campaign: string }>();
  for (const item of content.results) {
    const brand = brands.results.find(x => x.name.toLowerCase() === item.brand.toLowerCase()) ?? defaultBrand;
    let campaignId: number | null = null;
    if (item.campaign) {
      let campaign = await db.prepare("SELECT id FROM campaigns WHERE workspace_id = ? AND brand_id = ? AND lower(name) = lower(?)")
        .bind(workspace.id, brand.id, item.campaign).first<{ id: number }>();
      if (!campaign) {
        const result = await db.prepare("INSERT INTO campaigns (workspace_id, brand_id, name, status) VALUES (?, ?, ?, 'Draft')")
          .bind(workspace.id, brand.id, item.campaign).run();
        campaign = { id: Number(result.meta.last_row_id) };
      }
      campaignId = campaign.id;
    }
    await db.prepare(`UPDATE content_items SET brand_id = ?, campaign_id = ?,
      creator_member_id = COALESCE(creator_member_id, (SELECT id FROM members WHERE workspace_id = ? AND user_id = content_items.owner_id LIMIT 1))
      WHERE workspace_id = ? AND id = ?`).bind(brand.id, campaignId, workspace.id, workspace.id, item.id).run();
  }

  await db.prepare("UPDATE workspaces SET initialized = 1, model_version = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(workspace.id).run();
  await activity(db, actor, "workspace_migrated", "workspace", workspace.id, workspace.name, "Core records were linked to stable Brand, Campaign, and Pillar IDs.");
  }

  let currentVersion = await db.prepare("SELECT model_version AS modelVersion FROM workspaces WHERE id = ?")
    .bind(actor.workspaceId).first<{ modelVersion: number }>();
  if ((currentVersion?.modelVersion ?? workspace.modelVersion) < 3) {
    await db.prepare(`INSERT OR IGNORE INTO content_platform_variants
      (workspace_id, content_id, platform, title, caption, description, hashtags, cta, notes, planned_publish_at, status)
      SELECT workspace_id, id, platform, title, caption, '', '', '', '',
        CASE WHEN publish_date = '' THEN '' ELSE publish_date || 'T09:00' END, status
      FROM content_items
      WHERE workspace_id = ? AND platform IN ('Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'YouTube')`)
      .bind(actor.workspaceId).run();
    const fallback = await db.prepare(`SELECT COUNT(*) AS count FROM content_items
      WHERE workspace_id = ? AND platform != '' AND platform NOT IN ('Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'YouTube')`)
      .bind(actor.workspaceId).first<{ count: number }>();
    await db.prepare("UPDATE workspaces SET model_version = 3, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(actor.workspaceId).run();
    await activity(db, actor, "workspace_migrated", "workspace", workspace.id, workspace.name,
      "Milestone 2 records were prepared and existing Platform values were migrated to platform versions.",
      { modelVersion: 3, unsupportedLegacyPlatforms: Number(fallback?.count ?? 0) });
  }

  currentVersion = await db.prepare("SELECT model_version AS modelVersion FROM workspaces WHERE id = ?")
    .bind(actor.workspaceId).first<{ modelVersion: number }>();
  if ((currentVersion?.modelVersion ?? 0) >= 4) return;
  await db.prepare(`INSERT INTO content_status_history
    (workspace_id, content_id, from_status, to_status, actor_member_id, actor_name, note)
    SELECT workspace_id, id, status, status, ?, ?, 'Milestone 3 history baseline.' FROM content_items c
    WHERE workspace_id = ? AND NOT EXISTS (SELECT 1 FROM content_status_history h WHERE h.content_id = c.id)`)
    .bind(actor.id, actor.name, actor.workspaceId).run();
  await db.prepare(`INSERT OR IGNORE INTO approvals
    (workspace_id, content_id, requested_by_member_id, status, content_version, submission_note,
     decision_by_member_id, decision_note, decided_at)
    SELECT workspace_id, id, COALESCE(creator_member_id, ?),
      CASE WHEN status = 'Review' THEN 'pending' ELSE 'approved' END,
      CASE WHEN status = 'Review' THEN version WHEN version > 0 THEN version - 1 ELSE 0 END, 'Migrated from the existing workflow.',
      CASE WHEN status = 'Review' THEN NULL ELSE ? END,
      CASE WHEN status = 'Review' THEN '' ELSE 'Existing approved content migrated into approval history.' END,
      CASE WHEN status = 'Review' THEN '' ELSE CURRENT_TIMESTAMP END
    FROM content_items c WHERE workspace_id = ? AND status IN ('Review', 'Approved', 'Scheduled')
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.content_id = c.id)`)
    .bind(actor.id, actor.id, actor.workspaceId).run();
  await db.prepare("UPDATE workspaces SET model_version = 4, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(actor.workspaceId).run();
  await activity(db, actor, "workspace_migrated", "workspace", workspace.id, workspace.name,
    "Milestone 3 collaboration, approval, and status history records were prepared.", { modelVersion: 4 });
}

async function authenticate(ctx: Context): Promise<Actor> {
  const user = ctx.identity;
  if (!user) throw new HubError("Please sign in to continue.", 401);
  let actor = await ctx.db.prepare(`SELECT ${memberCols} FROM members
    WHERE lower(email) = lower(?) ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id LIMIT 1`)
    .bind(user.email, user.userId).first<Actor>();
  if (!actor) actor = await bootstrapOwner(ctx, user);
  if (!actor) throw new HubError(permissionMessage, 403);
  const authenticatedActor: Actor = actor;
  if (authenticatedActor.status === "Inactive" || (authenticatedActor.userId && authenticatedActor.userId !== user.userId)) deny();
  if (authenticatedActor.status === "Invited" || !authenticatedActor.userId) {
    await ctx.db.prepare(`UPDATE members SET user_id = ?, status = 'Active', name = ?
      WHERE id = ? AND status != 'Inactive' AND (user_id IS NULL OR user_id = ?)`)
      .bind(user.userId, user.displayName, authenticatedActor.id, user.userId).run();
    authenticatedActor.userId = user.userId;
    authenticatedActor.status = "Active";
    authenticatedActor.name = user.displayName;
  }
  await ensureWorkspaceModel(ctx.db, authenticatedActor);
  return authenticatedActor;
}

async function getItem(db: D1Database, actor: Actor, id: number) {
  const item = await db.prepare(`SELECT ${itemCols} FROM ${itemFrom} WHERE c.workspace_id = ? AND c.id = ?`)
    .bind(actor.workspaceId, id).first<ContentItem>();
  if (!item) throw new HubError("Content item not found.", 404);
  if (!canSee(actor, item)) deny();
  return item;
}

async function contentInput(db: D1Database, actor: Actor, payload: Record<string, unknown>, previous?: ContentItem) {
  const allowed = ["title", "brandId", "campaignId", "pillarId", "objective", "brief", "targetAudience", "keyMessage", "contentDirection", "references", "format", "priority", "assigneeId", "pic", "deadline", "publishDate", "platform", "status", "caption", "copyHook", "copyCta", "copyNotes", "notes", "version"];
  if (Object.keys(payload).some(x => !allowed.includes(x))) throw new HubError("This form contains an unsupported field.");
  const input = {
    title: "", brandId: null, brand: "", campaignId: null, campaign: "", pillarId: null, pillar: "",
    objective: "", brief: "", targetAudience: "", keyMessage: "", contentDirection: "", references: "", format: "Post", priority: "Normal", assigneeId: null,
    pic: "", creatorMemberId: actor.id, creatorName: actor.name, deadline: "", publishDate: "", platform: "Instagram",
    status: "Idea", caption: "", copyHook: "", copyCta: "", copyNotes: "", notes: "", version: 1, reviewDecision: "", createdAt: "", updatedAt: "",
    ...previous, ...payload,
  } as ContentItem;

  input.title = required(input.title, "Content title");
  input.brandId = idOf(input.brandId);
  input.campaignId = nullableId(input.campaignId);
  input.pillarId = nullableId(input.pillarId);
  input.objective = text(input.objective ?? "", 2000);
  input.brief = text(input.brief ?? "", 10000);
  input.targetAudience = text(input.targetAudience ?? "", 2000);
  input.keyMessage = text(input.keyMessage ?? "", 4000);
  input.contentDirection = text(input.contentDirection ?? "", 10000);
  input.references = text(input.references ?? "", 10000);
  input.format = text(input.format, 80) as ContentItem["format"];
  input.pic = text(input.pic ?? "", 120);
  input.deadline = validDate(input.deadline ?? "", "deadline", true);
  input.publishDate = validDate(input.publishDate, "publish date");
  input.platform = required(input.platform, "Platform", 80);
  input.caption = text(input.caption ?? "", 15000);
  input.copyHook = text(input.copyHook ?? "", 4000);
  input.copyCta = text(input.copyCta ?? "", 2000);
  input.copyNotes = text(input.copyNotes ?? "", 10000);
  input.notes = text(input.notes ?? "", 15000);
  input.assigneeId = nullableId(input.assigneeId);
  if (!statuses.includes(input.status)) throw new HubError("Choose a valid workflow status.");
  if (!priorities.includes(input.priority)) throw new HubError("Choose a valid priority.");
  if (!contentFormats.includes(input.format)) throw new HubError("Choose a valid content format.");
  if (!previous && actor.role === "Creative") { input.assigneeId = actor.id; input.pic = actor.name; }

  if (previous) {
    const fields = editableFields(actor, previous);
    for (const key of allowed.filter(x => !["version", "status"].includes(x))) {
      if (input[key as keyof ContentItem] !== previous[key as keyof ContentItem] && !fields.includes(key)) deny();
    }
    if (input.status !== previous.status && !canMove(actor, previous, input.status)) deny();
    if (!fields.length && input.status === previous.status) deny();
  } else if (input.status !== "Idea") deny();

  const brand = await db.prepare("SELECT id, name, archived FROM brands WHERE workspace_id = ? AND id = ?")
    .bind(actor.workspaceId, input.brandId).first<{ id: number; name: string; archived: number }>();
  if (!brand || (brand.archived && previous?.brandId !== brand.id)) throw new HubError("Choose an active Brand.");
  input.brand = brand.name;

  input.campaign = "";
  if (input.campaignId != null) {
    const campaign = await db.prepare("SELECT id, name, archived FROM campaigns WHERE workspace_id = ? AND brand_id = ? AND id = ?")
      .bind(actor.workspaceId, brand.id, input.campaignId).first<{ id: number; name: string; archived: number }>();
    if (!campaign || (campaign.archived && previous?.campaignId !== campaign.id)) throw new HubError("Choose an active Campaign for this Brand.");
    input.campaign = campaign.name;
  }

  input.pillar = "";
  if (input.pillarId != null) {
    const pillar = await db.prepare("SELECT id, name, active FROM pillars WHERE workspace_id = ? AND brand_id = ? AND id = ?")
      .bind(actor.workspaceId, brand.id, input.pillarId).first<Pillar>();
    if (!pillar || (!pillar.active && previous?.pillarId !== pillar.id)) throw new HubError("Choose an active Content Pillar for this Brand.");
    input.pillar = pillar.name;
  }

  if (input.assigneeId != null) {
    const member = await db.prepare("SELECT id, name, status FROM members WHERE workspace_id = ? AND id = ?")
      .bind(actor.workspaceId, input.assigneeId).first<Member>();
    if (!member || (member.status === "Inactive" && previous?.assigneeId !== member.id)) throw new HubError("Choose an active team member.");
    input.pic = member.name;
  }
  return input;
}

function ensureVersion(payload: Record<string, unknown>, item: ContentItem) {
  if (!Number.isInteger(payload.version) || payload.version !== item.version) {
    throw new HubError("This item changed since you opened it. Refresh and try again.", 409);
  }
}

function changed(result: D1Result) {
  if (!result.meta.changes) throw new HubError("This item changed. Refresh and try again.", 409);
}

async function listContent(request: Request, db: D1Database, actor: Actor) {
  const params = new URL(request.url).searchParams;
  const where = ["c.workspace_id = ?"];
  const values: unknown[] = [actor.workspaceId];
  if (actor.role === "Designer") { where.push("c.assignee_id = ?"); values.push(actor.id); }

  const numericFilters = [["brandId", "c.brand_id"], ["campaignId", "c.campaign_id"], ["pillarId", "c.pillar_id"]] as const;
  for (const [name, column] of numericFilters) {
    const value = params.get(name);
    if (value) { where.push(`${column} = ?`); values.push(idOf(value)); }
  }
  const exactFilters = [["status", "c.status"], ["platform", "c.platform"], ["pic", "c.pic"]] as const;
  for (const [name, column] of exactFilters) {
    const value = params.get(name);
    if (value) { where.push(`${column} = ?`); values.push(text(value, 120)); }
  }
  const query = text(params.get("query") ?? "", 200);
  if (query) {
    where.push("lower(c.title || ' ' || c.caption || ' ' || c.notes || ' ' || c.brief) LIKE ?");
    values.push(`%${query.toLowerCase()}%`);
  }
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (dateFrom) { where.push("c.publish_date >= ?"); values.push(validDate(dateFrom, "start date")); }
  if (dateTo) { where.push("c.publish_date <= ?"); values.push(validDate(dateTo, "end date")); }
  const limit = Math.min(Math.max(Number(params.get("limit") || 40), 1), 100);
  const offset = Math.min(Math.max(Number(params.get("offset") || 0), 0), 10000);
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new HubError("Choose a valid page.");

  const condition = where.join(" AND ");
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${itemCols} FROM ${itemFrom} WHERE ${condition} ORDER BY c.publish_date, c.id LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset).all<ContentItem>(),
    db.prepare(`SELECT COUNT(*) AS total FROM content_items c WHERE ${condition}`).bind(...values).first<{ total: number }>(),
  ]);
  return { items: rows.results, total: Number(count?.total ?? 0), limit, offset };
}

export async function handleHub(request: Request, path: string[], ctx: Context): Promise<Response> {
  try {
    mutationAllowed(request);
    const actor = await authenticate(ctx);
    rateLimit(actor, request);
    const db = ctx.db;
    const scope = actor.workspaceId;
    const [resource, key, action] = path;
    const method = request.method;

    const milestoneThree = await handleMilestoneThree(request, path, { db, actor });
    if (milestoneThree) return milestoneThree;
    const milestoneTwo = await handleMilestoneTwo(request, path, { db, bucket: ctx.bucket, actor });
    if (milestoneTwo) return milestoneTwo;

    if (resource === "workspace" && method === "GET") {
      const [workspace, content, pillars, members, brands, campaigns] = await Promise.all([
        db.prepare(`SELECT id, name, slug, timezone, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?`).bind(scope).first(),
        db.prepare(`SELECT ${itemCols} FROM ${itemFrom} WHERE c.workspace_id = ? ${actor.role === "Designer" ? "AND c.assignee_id = ?" : ""} ORDER BY c.publish_date, c.id`).bind(...(actor.role === "Designer" ? [scope, actor.id] : [scope])).all(),
        db.prepare(`SELECT p.id, p.brand_id AS brandId, p.name, p.description, p.objective, p.color, p.active, p.position,
          p.created_at AS createdAt, p.updated_at AS updatedAt,
          (SELECT COUNT(*) FROM content_items c WHERE c.workspace_id = p.workspace_id AND c.pillar_id = p.id) AS usage
          FROM pillars p WHERE p.workspace_id = ? ORDER BY p.position, p.id`).bind(scope).all(),
        db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = ? ORDER BY CASE WHEN role = 'Owner' THEN 0 ELSE 1 END, name`).bind(scope).all<Member>(),
        db.prepare(`SELECT b.id, b.workspace_id AS workspaceId, b.name, b.description, b.slug, b.logo, b.timezone, b.archived,
          b.created_at AS createdAt, b.updated_at AS updatedAt,
          (SELECT COUNT(*) FROM content_items c WHERE c.workspace_id = b.workspace_id AND c.brand_id = b.id) AS usage
          FROM brands b WHERE b.workspace_id = ? ORDER BY b.archived, b.name`).bind(scope).all(),
        db.prepare(`SELECT cp.id, cp.brand_id AS brandId, b.name AS brandName, cp.name, cp.description, cp.objective,
          cp.target_audience AS targetAudience, cp.start_date AS startDate, cp.end_date AS endDate,
          cp.owner_member_id AS ownerMemberId, COALESCE(m.name, '') AS ownerName, cp.status, cp.archived,
          cp.created_at AS createdAt, cp.updated_at AS updatedAt,
          (SELECT COUNT(*) FROM content_items c WHERE c.workspace_id = cp.workspace_id AND c.campaign_id = cp.id) AS usage
          FROM campaigns cp JOIN brands b ON b.id = cp.brand_id LEFT JOIN members m ON m.id = cp.owner_member_id
          WHERE cp.workspace_id = ? ORDER BY cp.archived, cp.name`).bind(scope).all<Campaign>(),
      ]);
      const visibleMembers = managers(actor.role)
        ? members.results
        : members.results.filter(x => x.status !== "Inactive").map(x => ({ id: x.id, name: x.name, status: x.status, role: x.role, userId: null, email: "" }));
      return json({ actor, workspace, items: content.results, pillars: pillars.results, members: visibleMembers, brands: brands.results, campaigns: campaigns.results });
    }

    if (resource === "workspace" && method === "PATCH") {
      if (actor.role !== "Owner") deny();
      const input = await body(request);
      const current = await db.prepare("SELECT name, slug, timezone FROM workspaces WHERE id = ?").bind(scope).first<{ name: string; slug: string; timezone: string }>();
      if (!current) throw new HubError("Workspace not found.", 404);
      const name = required(input.name ?? current.name, "Workspace name", 100);
      const timezone = validTimezone(input.timezone ?? current.timezone);
      const slug = input.slug == null ? current.slug : await uniqueSlug(db, scope, "workspaces", required(input.slug, "Workspace URL label", 80), scope);
      await db.prepare("UPDATE workspaces SET name = ?, slug = ?, timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(name, slugify(slug), timezone, scope).run();
      await activity(db, actor, "workspace_updated", "workspace", scope, name, "Workspace details were updated.");
      return json({ saved: true });
    }

    if (resource === "content") {
      if (method === "GET" && key) return json({ item: await getItem(db, actor, idOf(key)) });
      if (method === "GET") return json(await listContent(request, db, actor));
      if (method === "POST" && !key) {
        if (!canCreate(actor.role)) deny();
        const input = await contentInput(db, actor, await body(request));
        const result = await db.prepare(`INSERT INTO content_items
          (owner_id, workspace_id, brand_id, brand, campaign_id, campaign, pillar_id, pillar, title, objective, brief,
           target_audience, key_message, content_direction, "references", format, priority, assignee_id, pic, creator_member_id,
           deadline, publish_date, platform, status, caption, copy_hook, copy_cta, copy_notes, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(actor.userId, scope, input.brandId, input.brand, input.campaignId, input.campaign, input.pillarId, input.pillar,
            input.title, input.objective, input.brief, input.targetAudience, input.keyMessage, input.contentDirection, input.references,
            input.format, input.priority, input.assigneeId, input.pic, actor.id, input.deadline, input.publishDate, input.platform,
            input.status, input.caption, input.copyHook, input.copyCta, input.copyNotes, input.notes).run();
        const id = Number(result.meta.last_row_id);
        await activity(db, actor, "content_created", "content", id, input.title, `Created in ${input.status}.`, { status: input.status });
        return json({ item: await getItem(db, actor, id) }, 201);
      }
      if (key) {
        const item = await getItem(db, actor, idOf(key));
        if (method === "DELETE") {
          if (!canDelete(actor.role)) deny();
          const input = await body(request);
          ensureVersion(input, item);
          const result = await db.prepare("DELETE FROM content_items WHERE workspace_id = ? AND id = ? AND version = ?")
            .bind(scope, item.id, item.version).run();
          changed(result);
          await activity(db, actor, "content_deleted", "content", item.id, item.title, "Content was permanently deleted after confirmation.", { status: item.status });
          return json({ deleted: true });
        }
        if (method === "PATCH" && action === "status") {
          const input = await body(request);
          ensureVersion(input, item);
          const target = input.status as ContentItem["status"];
          if (!statuses.includes(target)) throw new HubError("Choose a valid workflow status.");
          if (target === item.status || !canMove(actor, item, target)) deny();
          const decision = input.decision === "rejected" ? "rejected" : target === "Approved" ? "approved" : target === "Revision" ? "revision" : "";
          if (input.decision && input.decision !== "rejected") throw new HubError("Invalid review decision.");
          if (decision === "rejected" && (!(["Owner", "Admin", "Approver"].includes(actor.role)) || item.status !== "Review" || target !== "Revision")) deny();
          const result = await db.prepare(`UPDATE content_items SET status = ?, review_decision = ?, version = version + 1,
            updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND version = ?`)
            .bind(target, decision, scope, item.id, item.version).run();
          changed(result);
          await activity(db, actor, decision ? "approval_action" : "status_changed", "content", item.id, item.title,
            decision ? `${decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Requested revision"}.` : `Moved from ${item.status} to ${target}.`,
            { from: item.status, to: target, decision });
          return json({ item: await getItem(db, actor, item.id) });
        }
        if (method === "PUT" && !action) {
          const payload = await body(request);
          ensureVersion(payload, item);
          const next = await contentInput(db, actor, payload, item);
          if (next.status === "Scheduled" && next.status !== item.status && !await hasApprovedReview({ db, actor }, item)) {
            throw new HubError("This content must be approved before it can be scheduled.", 409);
          }
          const fields = ["title", "brandId", "campaignId", "pillarId", "objective", "brief", "targetAudience", "keyMessage", "contentDirection", "references", "format", "priority", "assigneeId", "pic", "deadline", "publishDate", "platform", "status", "caption", "copyHook", "copyCta", "copyNotes", "notes"] as const;
          const modified = fields.filter(field => next[field] !== item[field]);
          const reviewDecision = next.status !== item.status ? (next.status === "Approved" ? "approved" : next.status === "Revision" ? "revision" : "") : item.reviewDecision;
          const result = await db.prepare(`UPDATE content_items SET brand_id = ?, brand = ?, campaign_id = ?, campaign = ?,
            pillar_id = ?, pillar = ?, title = ?, objective = ?, brief = ?, target_audience = ?, key_message = ?, content_direction = ?, "references" = ?, format = ?, priority = ?,
            assignee_id = ?, pic = ?, deadline = ?, publish_date = ?, platform = ?, status = ?, caption = ?, copy_hook = ?, copy_cta = ?, copy_notes = ?, notes = ?,
            review_decision = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE workspace_id = ? AND id = ? AND version = ?`)
            .bind(next.brandId, next.brand, next.campaignId, next.campaign, next.pillarId, next.pillar, next.title, next.objective,
            next.brief, next.targetAudience, next.keyMessage, next.contentDirection, next.references, next.format, next.priority,
              next.assigneeId, next.pic, next.deadline, next.publishDate, next.platform, next.status, next.caption, next.copyHook,
              next.copyCta, next.copyNotes, next.notes, reviewDecision, scope, item.id, item.version).run();
          changed(result);
          await recordEmbeddedStatusChange({ db, actor }, item, { ...item, ...next, version: item.version + 1 });
          if (next.status !== item.status) {
            await activity(db, actor, next.status === "Review" ? "review_requested" : "status_changed",
              "content", item.id, next.title, next.status === "Review" ? "Submitted for review." : `Moved from ${item.status} to ${next.status}.`, { from: item.status, to: next.status });
          }
          const detailFields = modified.filter(x => x !== "status");
          const briefFields = detailFields.filter(x => ["objective", "targetAudience", "keyMessage", "contentDirection", "brief", "references", "notes"].includes(x));
          const copyFields = detailFields.filter(x => ["caption", "copyHook", "copyCta", "copyNotes"].includes(x));
          const overviewFields = detailFields.filter(x => !briefFields.includes(x) && !copyFields.includes(x));
          if (briefFields.length) await activity(db, actor, "brief_updated", "content", item.id, next.title, "Creative brief updated.", { fields: briefFields });
          if (copyFields.length) await activity(db, actor, "copy_updated", "content", item.id, next.title, "Master Copy updated.", { fields: copyFields });
          if (overviewFields.length) await activity(db, actor, "content_updated", "content", item.id, next.title,
            `Updated ${overviewFields.map(x => x === "publishDate" ? "publish date" : x === "assigneeId" ? "PIC" : x).join(", ")}.`, { fields: overviewFields });
          return json({ item: await getItem(db, actor, item.id) });
        }
      }
    }

    if (resource === "brands") {
      if (!managers(actor.role)) deny();
      const current = key ? await db.prepare("SELECT id, name, description, slug, logo, timezone, archived FROM brands WHERE workspace_id = ? AND id = ?").bind(scope, idOf(key)).first<BrandRow>() : null;
      if (key && !current) throw new HubError("Brand not found.", 404);
      if (method === "PATCH" && current && action === "archive") {
        const input = await body(request);
        if (typeof input.archived !== "boolean") throw new HubError("Choose whether this Brand is archived.");
        await db.prepare("UPDATE brands SET archived = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
          .bind(input.archived ? 1 : 0, scope, current.id).run();
        await activity(db, actor, input.archived ? "brand_archived" : "brand_restored", "brand", current.id, current.name,
          input.archived ? "Brand archived. Related content was preserved." : "Brand restored.");
        return json({ saved: true });
      }
      if (method === "POST" && !key || method === "PUT" && current) {
        const input = await body(request);
        const name = required(input.name, "Brand name", 100);
        const description = text(input.description ?? "", 2000);
        const timezone = validTimezone(input.timezone ?? "Asia/Jakarta");
        const logo = text(input.logo ?? "", 1000);
        const duplicate = await db.prepare("SELECT id FROM brands WHERE workspace_id = ? AND lower(name) = lower(?) AND id != ?")
          .bind(scope, name, current?.id ?? 0).first();
        if (duplicate) throw new HubError("A Brand with this name already exists.", 409);
        const slug = await uniqueSlug(db, scope, "brands", text(input.slug || name, 80), current?.id);
        if (current) {
          await db.batch([
            db.prepare("UPDATE brands SET name = ?, description = ?, slug = ?, logo = ?, timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
              .bind(name, description, slug, logo, timezone, scope, current.id),
            db.prepare("UPDATE content_items SET brand = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND brand_id = ?")
              .bind(name, scope, current.id),
          ]);
          await activity(db, actor, "brand_updated", "brand", current.id, name, "Brand details were updated.");
        } else {
          const result = await db.prepare("INSERT INTO brands (workspace_id, name, description, slug, logo, timezone) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(scope, name, description, slug, logo, timezone).run();
          await activity(db, actor, "brand_created", "brand", Number(result.meta.last_row_id), name, "Brand created.");
        }
        return json({ saved: true }, current ? 200 : 201);
      }
    }

    if (resource === "campaigns") {
      if (!strategists(actor.role)) deny();
      const current = key ? await db.prepare("SELECT id, brand_id, name, status, archived FROM campaigns WHERE workspace_id = ? AND id = ?").bind(scope, idOf(key)).first<CampaignRow>() : null;
      if (key && !current) throw new HubError("Campaign not found.", 404);
      if (method === "PATCH" && current && action === "archive") {
        const input = await body(request);
        if (typeof input.archived !== "boolean") throw new HubError("Choose whether this Campaign is archived.");
        const status = input.archived ? "Archived" : current.status === "Archived" ? "Draft" : current.status;
        await db.prepare("UPDATE campaigns SET archived = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
          .bind(input.archived ? 1 : 0, status, scope, current.id).run();
        await activity(db, actor, input.archived ? "campaign_archived" : "campaign_restored", "campaign", current.id, current.name,
          input.archived ? "Campaign archived. Related content was preserved." : "Campaign restored.");
        return json({ saved: true });
      }
      if (method === "POST" && !key || method === "PUT" && current) {
        const input = await body(request);
        const brandId = idOf(input.brandId);
        const brand = await db.prepare("SELECT id, name, archived FROM brands WHERE workspace_id = ? AND id = ?").bind(scope, brandId).first<{ id: number; name: string; archived: number }>();
        if (!brand || (brand.archived && current?.brand_id !== brand.id)) throw new HubError("Choose an active Brand.");
        const name = required(input.name, "Campaign name", 100);
        const description = text(input.description ?? "", 2000);
        const objective = text(input.objective ?? "", 2000);
        const targetAudience = text(input.targetAudience ?? "", 2000);
        const startDate = validDate(input.startDate ?? "", "start date", true);
        const endDate = validDate(input.endDate ?? "", "end date", true);
        if (startDate && endDate && endDate < startDate) throw new HubError("End date cannot be before start date.");
        const ownerMemberId = nullableId(input.ownerMemberId);
        if (ownerMemberId && !await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND id = ? AND status != 'Inactive'").bind(scope, ownerMemberId).first()) throw new HubError("Choose an active Campaign owner.");
        const status = text(input.status ?? "Draft", 40) as Campaign["status"];
        if (!campaignStatuses.includes(status)) throw new HubError("Choose a valid Campaign status.");
        const duplicate = await db.prepare("SELECT id FROM campaigns WHERE workspace_id = ? AND brand_id = ? AND lower(name) = lower(?) AND id != ?")
          .bind(scope, brandId, name, current?.id ?? 0).first();
        if (duplicate) throw new HubError("A Campaign with this name already exists for this Brand.", 409);
        if (current) {
          await db.batch([
            db.prepare(`UPDATE campaigns SET brand_id = ?, name = ?, description = ?, objective = ?, target_audience = ?,
              start_date = ?, end_date = ?, owner_member_id = ?, status = ?, archived = ?, updated_at = CURRENT_TIMESTAMP
              WHERE workspace_id = ? AND id = ?`).bind(brandId, name, description, objective, targetAudience, startDate, endDate,
                ownerMemberId, status, status === "Archived" ? 1 : Number(current.archived), scope, current.id),
            db.prepare("UPDATE content_items SET campaign = ?, brand_id = ?, brand = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND campaign_id = ?")
              .bind(name, brandId, brand.name, scope, current.id),
          ]);
          await activity(db, actor, "campaign_updated", "campaign", current.id, name, "Campaign details were updated.");
        } else {
          const result = await db.prepare(`INSERT INTO campaigns
            (workspace_id, brand_id, name, description, objective, target_audience, start_date, end_date, owner_member_id, status, archived)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(scope, brandId, name, description, objective, targetAudience, startDate, endDate, ownerMemberId, status, status === "Archived" ? 1 : 0).run();
          await activity(db, actor, "campaign_created", "campaign", Number(result.meta.last_row_id), name, "Campaign created.");
        }
        return json({ saved: true }, current ? 200 : 201);
      }
    }

    if (resource === "pillars") {
      if (!strategists(actor.role)) deny();
      if (key === "reorder" && method === "PATCH") {
        const input = await body(request);
        const ids = input.ids;
        const all = await db.prepare("SELECT id FROM pillars WHERE workspace_id = ?").bind(scope).all<{ id: number }>();
        if (!Array.isArray(ids) || ids.length !== all.results.length || new Set(ids).size !== ids.length || !ids.every(id => all.results.some(x => x.id === id))) throw new HubError("Refresh the Pillar list before reordering.", 409);
        if (ids.length) await db.batch(ids.map((id, index) => db.prepare("UPDATE pillars SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?").bind(index, scope, id)));
        return json({ saved: true });
      }
      const pillar = key ? await db.prepare("SELECT id, brand_id, name FROM pillars WHERE workspace_id = ? AND id = ?").bind(scope, idOf(key)).first<PillarRow>() : null;
      if (key && !pillar) throw new HubError("Content Pillar not found.", 404);
      if (method === "DELETE" && pillar) {
        const input = await body(request);
        if (input.confirm !== true) throw new HubError("Confirm deletion. Existing content will be kept without this Pillar.");
        await db.batch([
          db.prepare("UPDATE content_items SET pillar_id = NULL, pillar = '', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND pillar_id = ?").bind(scope, pillar.id),
          db.prepare("DELETE FROM pillars WHERE workspace_id = ? AND id = ?").bind(scope, pillar.id),
        ]);
        await activity(db, actor, "pillar_deleted", "pillar", pillar.id, pillar.name, "Pillar deleted. Existing content was preserved without a Pillar.");
        return json({ deleted: true });
      }
      if (method === "POST" && !key || method === "PUT" && pillar) {
        const input = await body(request);
        const brandId = idOf(input.brandId ?? pillar?.brand_id);
        if (!await db.prepare("SELECT id FROM brands WHERE workspace_id = ? AND id = ? AND archived = 0").bind(scope, brandId).first()) throw new HubError("Choose an active Brand.");
        const name = required(input.name, "Pillar name", 100);
        const description = text(input.description ?? "", 2000);
        const objective = text(input.objective ?? "", 1000);
        const color = text(input.color, 7);
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HubError("Choose a valid color.");
        if (typeof input.active !== "boolean") throw new HubError("Choose an active or inactive status.");
        const duplicate = await db.prepare("SELECT id FROM pillars WHERE workspace_id = ? AND brand_id = ? AND lower(name) = lower(?) AND id != ?")
          .bind(scope, brandId, name, pillar?.id ?? 0).first();
        if (duplicate) throw new HubError("A Pillar with this name already exists for this Brand.", 409);
        if (pillar) {
          await db.batch([
            db.prepare(`UPDATE pillars SET brand_id = ?, name = ?, description = ?, objective = ?, color = ?, active = ?,
              updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
              .bind(brandId, name, description, objective, color, input.active ? 1 : 0, scope, pillar.id),
            db.prepare("UPDATE content_items SET pillar = ?, brand_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND pillar_id = ?")
              .bind(name, brandId, scope, pillar.id),
          ]);
          await activity(db, actor, "pillar_updated", "pillar", pillar.id, name, input.active ? "Pillar updated." : "Pillar disabled. Existing content was preserved.");
        } else {
          const result = await db.prepare(`INSERT INTO pillars
            (workspace_id, brand_id, name, description, objective, color, active, position, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM pillars WHERE workspace_id = ?), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
            .bind(scope, brandId, name, description, objective, color, input.active ? 1 : 0, scope).run();
          await activity(db, actor, "pillar_created", "pillar", Number(result.meta.last_row_id), name, "Content Pillar created.");
        }
        return json({ saved: true }, pillar ? 200 : 201);
      }
    }

    if (resource === "members") {
      if (!managers(actor.role)) deny();
      if (method === "POST" && !key) {
        const input = await body(request);
        const email = required(input.email, "Email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HubError("Enter a valid email address.");
        if (!roles.includes(input.role as Member["role"]) || input.role === "Owner") deny();
        if (await db.prepare("SELECT id FROM members WHERE lower(email) = lower(?)").bind(email).first()) throw new HubError("This member already exists.", 409);
        const name = required(input.name, "Name", 120);
        const result = await db.prepare("INSERT INTO members (workspace_id, name, email, role, status) VALUES (?, ?, ?, ?, 'Invited')")
          .bind(scope, name, email, input.role).run();
        await activity(db, actor, "member_added", "member", Number(result.meta.last_row_id), name, `Added as ${input.role}.`);
        return json({ saved: true }, 201);
      }
      if (method === "PATCH" && key) {
        const target = await db.prepare(`SELECT ${memberCols} FROM members WHERE workspace_id = ? AND id = ?`).bind(scope, idOf(key)).first<Member>();
        if (!target) throw new HubError("Member not found.", 404);
        const input = await body(request);
        if (target.role === "Owner" || target.id === actor.id || input.role === "Owner") deny();
        const role = input.role ?? target.role;
        const status = input.status ?? target.status;
        if (!roles.includes(role as Member["role"]) || !["Active", "Invited", "Inactive"].includes(String(status))) throw new HubError("Choose a valid role and status.");
        if (status === "Active" && !target.userId) throw new HubError("This member must sign in before becoming active.");
        await db.prepare("UPDATE members SET role = ?, status = ? WHERE workspace_id = ? AND id = ? AND role != 'Owner'")
          .bind(role, status, scope, target.id).run();
        if (role !== target.role) await activity(db, actor, "member_role_changed", "member", target.id, target.name, `Role changed from ${target.role} to ${role}.`);
        if (status !== target.status) await activity(db, actor, status === "Inactive" ? "member_disabled" : "member_reactivated", "member", target.id, target.name, `Member status changed to ${status}.`);
        return json({ saved: true });
      }
    }

    if (resource === "activity" && method === "GET") {
      const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || 50), 1), 100);
      const result = await db.prepare(`SELECT id, actor_member_id AS actorMemberId, actor_name AS actorName, action,
        entity_type AS entityType, entity_id AS entityId, entity_title AS entityTitle, summary, created_at AS createdAt
        FROM activity_history WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`).bind(scope, limit).all();
      return json({ activities: result.results });
    }

    throw new HubError("This action is not available.", 404);
  } catch (error) {
    if (error instanceof HubError) return json({ error: error.message }, error.status);
    console.error("Creative Hub request failed", error);
    return json({ error: "We could not save or load your workspace. Your changes are still in the form. Please try again." }, 500);
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
