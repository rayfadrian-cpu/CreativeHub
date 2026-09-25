import {
  assetUsages, canManageContentAssets, canManageLibraryAsset, canManageVariants, canSee, canUploadMedia,
  statuses, variantPlatforms,
  type Actor, type ContentAsset, type ContentItem, type MediaAsset, type PlatformVariant,
} from "../lib/hub-types.ts";
import { HubError } from "./hub-error.ts";
import { collaborationSnapshot } from "./milestone-three.ts";

type Context = { db: D1Database; bucket?: R2Bucket; actor: Actor };
type MediaRow = Omit<MediaAsset, "kind"> & { kind: MediaAsset["kind"] };

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
const mediaCols = `m.id, m.file_name AS fileName, m.original_name AS originalName, m.kind, m.mime_type AS mimeType,
  m.file_size AS fileSize, m.storage_key AS storageKey, m.width, m.height, m.duration_seconds AS durationSeconds,
  m.uploader_member_id AS uploaderMemberId, COALESCE(u.name, '') AS uploaderName,
  m.created_at AS createdAt, m.updated_at AS updatedAt,
  ((SELECT COUNT(*) FROM content_media_assets cma WHERE cma.media_asset_id = m.id) +
   (SELECT COUNT(*) FROM platform_variant_media_assets pvma WHERE pvma.media_asset_id = m.id)) AS attachmentCount`;

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
async function activity(ctx: Context, action: string, entityType: string, entityId: string | number, entityTitle: string, summary: string, context: Record<string, unknown> = {}) {
  await ctx.db.prepare(`INSERT INTO activity_history
    (workspace_id, actor_member_id, actor_name, action, entity_type, entity_id, entity_title, summary, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.actor.workspaceId, ctx.actor.id, ctx.actor.name, action, entityType, String(entityId), entityTitle, summary, JSON.stringify(context).slice(0, 8000)).run();
}
async function loadItem(ctx: Context, id: number) {
  const item = await ctx.db.prepare(`SELECT ${itemCols} FROM ${itemFrom} WHERE c.workspace_id = ? AND c.id = ?`)
    .bind(ctx.actor.workspaceId, id).first<ContentItem>();
  if (!item) throw new HubError("Content item not found.", 404);
  if (!canSee(ctx.actor, item)) deny();
  return item;
}
async function loadMedia(ctx: Context, id: number) {
  const asset = await ctx.db.prepare(`SELECT ${mediaCols} FROM media_assets m LEFT JOIN members u ON u.id = m.uploader_member_id
    WHERE m.workspace_id = ? AND m.id = ?`).bind(ctx.actor.workspaceId, id).first<MediaRow>();
  if (!asset) throw new HubError("Media file not found.", 404);
  return asset;
}
function requireBucket(ctx: Context) {
  if (!ctx.bucket) throw new HubError("Media storage is temporarily unavailable.", 503);
  return ctx.bucket;
}
function assetKind(mime: string): MediaAsset["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
const allowedMime = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime",
  "application/pdf", "text/plain", "text/csv", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
function optionalInteger(value: string | null, max: number) {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new HubError("Invalid file metadata.");
  return number;
}
function cleanStorageName(name: string) {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "file").slice(-100);
}
function validPlannedAt(value: unknown) {
  const result = text(value ?? "", 40);
  if (result && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(result)) throw new HubError("Choose a valid planned publish date and time.");
  return result;
}
async function contentAssets(ctx: Context, contentId: number): Promise<ContentAsset[]> {
  const result = await ctx.db.prepare(`SELECT ${mediaCols}, cma.id AS linkId, cma.usage, cma.position
    FROM content_media_assets cma JOIN media_assets m ON m.id = cma.media_asset_id
    LEFT JOIN members u ON u.id = m.uploader_member_id
    WHERE cma.workspace_id = ? AND cma.content_id = ? ORDER BY cma.position, cma.id`)
    .bind(ctx.actor.workspaceId, contentId).all<ContentAsset>();
  return result.results;
}
async function variantAssets(ctx: Context, variantId: number): Promise<ContentAsset[]> {
  const result = await ctx.db.prepare(`SELECT ${mediaCols}, pvma.id AS linkId, pvma.usage, pvma.position
    FROM platform_variant_media_assets pvma JOIN media_assets m ON m.id = pvma.media_asset_id
    LEFT JOIN members u ON u.id = m.uploader_member_id
    WHERE pvma.workspace_id = ? AND pvma.variant_id = ? ORDER BY pvma.position, pvma.id`)
    .bind(ctx.actor.workspaceId, variantId).all<ContentAsset>();
  return result.results;
}
async function variants(ctx: Context, contentId: number) {
  const result = await ctx.db.prepare(`SELECT id, content_id AS contentId, platform, title, caption, description, hashtags, cta, notes,
    planned_publish_at AS plannedPublishAt, status, version, created_at AS createdAt, updated_at AS updatedAt
    FROM content_platform_variants WHERE workspace_id = ? AND content_id = ? ORDER BY id`)
    .bind(ctx.actor.workspaceId, contentId).all<PlatformVariant>();
  return Promise.all(result.results.map(async variant => ({ ...variant, assets: await variantAssets(ctx, variant.id) })));
}
async function loadVariant(ctx: Context, id: number) {
  const variant = await ctx.db.prepare(`SELECT id, content_id AS contentId, platform, title, caption, description, hashtags, cta, notes,
    planned_publish_at AS plannedPublishAt, status, version, created_at AS createdAt, updated_at AS updatedAt
    FROM content_platform_variants WHERE workspace_id = ? AND id = ?`).bind(ctx.actor.workspaceId, id).first<PlatformVariant>();
  if (!variant) throw new HubError("Platform version not found.", 404);
  const item = await loadItem(ctx, variant.contentId);
  return { variant, item };
}
function variantInput(payload: Record<string, unknown>, previous?: PlatformVariant) {
  const input = {
    platform: previous?.platform ?? "Instagram", title: previous?.title ?? "", caption: previous?.caption ?? "",
    description: previous?.description ?? "", hashtags: previous?.hashtags ?? "", cta: previous?.cta ?? "",
    notes: previous?.notes ?? "", plannedPublishAt: previous?.plannedPublishAt ?? "", status: previous?.status ?? "Idea",
    ...payload,
  };
  const platform = required(input.platform, "Platform", 40) as PlatformVariant["platform"];
  if (!variantPlatforms.includes(platform)) throw new HubError("Choose a supported platform.");
  const status = required(input.status, "Status", 40) as ContentItem["status"];
  if (!statuses.includes(status)) throw new HubError("Choose a valid workflow status.");
  return {
    platform, status, title: text(input.title, 200), caption: text(input.caption, 15_000),
    description: text(input.description, 20_000), hashtags: text(input.hashtags, 4_000), cta: text(input.cta, 2_000),
    notes: text(input.notes, 10_000), plannedPublishAt: validPlannedAt(input.plannedPublishAt),
  };
}
function usage(value: unknown) {
  const result = required(value ?? "Supporting Asset", "Asset purpose", 40) as ContentAsset["usage"];
  if (!assetUsages.includes(result)) throw new HubError("Choose a valid asset purpose.");
  return result;
}

export async function handleMilestoneTwo(request: Request, path: string[], ctx: Context): Promise<Response | null> {
  const [resource, key, action, detail] = path;
  const method = request.method;

  if (resource === "media") {
    if (method === "GET" && key && action === "file") {
      const asset = await loadMedia(ctx, idOf(key));
      const object = await requireBucket(ctx).get(asset.storageKey);
      if (!object) throw new HubError("The stored file could not be found.", 404);
      const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
      return new Response(object.body, { headers: {
        "Content-Type": asset.mimeType, "Content-Length": String(asset.fileSize),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "Cache-Control": "private, max-age=60", "ETag": object.httpEtag, "X-Content-Type-Options": "nosniff",
      } });
    }
    if (method === "GET" && !key) {
      const params = new URL(request.url).searchParams;
      const where = ["m.workspace_id = ?"];
      const values: unknown[] = [ctx.actor.workspaceId];
      const query = text(params.get("query") ?? "", 200);
      if (query) { where.push("lower(m.file_name || ' ' || m.original_name || ' ' || m.mime_type) LIKE ?"); values.push(`%${query.toLowerCase()}%`); }
      const kind = text(params.get("kind") ?? "", 20);
      if (kind) {
        if (!["image", "video", "document"].includes(kind)) throw new HubError("Choose a valid file type.");
        where.push("m.kind = ?"); values.push(kind);
      }
      const rows = await ctx.db.prepare(`SELECT ${mediaCols} FROM media_assets m LEFT JOIN members u ON u.id = m.uploader_member_id
        WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT 200`).bind(...values).all<MediaRow>();
      return json({ assets: rows.results });
    }
    if (method === "POST" && key === "upload") {
      if (!canUploadMedia(ctx.actor.role)) deny();
      const bucket = requireBucket(ctx);
      const params = new URL(request.url).searchParams;
      const fileName = required(params.get("fileName") ?? "", "File name", 180);
      const mimeType = required(request.headers.get("content-type")?.split(";")[0] ?? "", "File type", 120).toLowerCase();
      if (!allowedMime.has(mimeType)) throw new HubError("This file type is not supported.", 415);
      const fileSize = Number(request.headers.get("content-length"));
      const max = mimeType.startsWith("video/") ? 75 * 1024 * 1024 : 25 * 1024 * 1024;
      if (!Number.isInteger(fileSize) || fileSize < 1) throw new HubError("The file is empty or its size is unavailable.");
      if (fileSize > max) throw new HubError(`This ${mimeType.startsWith("video/") ? "video" : "file"} is larger than the ${mimeType.startsWith("video/") ? "75 MB" : "25 MB"} limit.`, 413);
      if (!request.body) throw new HubError("The file is empty.");
      const width = optionalInteger(params.get("width"), 100_000);
      const height = optionalInteger(params.get("height"), 100_000);
      const durationSeconds = optionalInteger(params.get("durationSeconds"), 86_400);
      const storageKey = `${ctx.actor.workspaceId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${cleanStorageName(fileName)}`;
      await bucket.put(storageKey, request.body, { httpMetadata: { contentType: mimeType }, customMetadata: { originalName: fileName, uploader: String(ctx.actor.id) } });
      try {
        const result = await ctx.db.prepare(`INSERT INTO media_assets
          (workspace_id, file_name, original_name, kind, mime_type, file_size, storage_key, width, height, duration_seconds, uploader_member_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(ctx.actor.workspaceId, fileName, fileName, assetKind(mimeType), mimeType, fileSize, storageKey, width, height, durationSeconds, ctx.actor.id).run();
        const id = Number(result.meta.last_row_id);
        await activity(ctx, "asset_uploaded", "media_asset", id, fileName, `Uploaded ${assetKind(mimeType)} file.`, { mimeType, fileSize });
        return json({ asset: await loadMedia(ctx, id) }, 201);
      } catch (error) {
        await bucket.delete(storageKey);
        throw error;
      }
    }
    if (key) {
      const asset = await loadMedia(ctx, idOf(key));
      if (method === "PUT" && !action) {
        if (!canManageLibraryAsset(ctx.actor, asset)) deny();
        const input = await jsonBody(request);
        const fileName = required(input.fileName, "File name", 180);
        await ctx.db.prepare("UPDATE media_assets SET file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?")
          .bind(fileName, ctx.actor.workspaceId, asset.id).run();
        await activity(ctx, "file_renamed", "media_asset", asset.id, fileName, `Renamed from ${asset.fileName}.`);
        return json({ asset: await loadMedia(ctx, asset.id) });
      }
      if (method === "DELETE" && !action) {
        if (!canManageLibraryAsset(ctx.actor, asset)) deny();
        if (asset.attachmentCount) throw new HubError("Detach this file from all Content and platform versions before deleting it.", 409);
        await requireBucket(ctx).delete(asset.storageKey);
        await ctx.db.prepare("DELETE FROM media_assets WHERE workspace_id = ? AND id = ?").bind(ctx.actor.workspaceId, asset.id).run();
        await activity(ctx, "file_deleted", "media_asset", asset.id, asset.fileName, "File deleted from Media Library.");
        return json({ deleted: true });
      }
    }
    return null;
  }

  if (resource === "content" && key && action === "workspace" && method === "GET") {
    const item = await loadItem(ctx, idOf(key));
    const [itemVariants, assets, history, collaboration] = await Promise.all([
      variants(ctx, item.id), contentAssets(ctx, item.id),
      ctx.db.prepare(`SELECT id, actor_member_id AS actorMemberId, actor_name AS actorName, action,
        entity_type AS entityType, entity_id AS entityId, entity_title AS entityTitle, summary, created_at AS createdAt
        FROM activity_history WHERE workspace_id = ? AND entity_type = 'content' AND entity_id = ? ORDER BY id DESC LIMIT 100`)
        .bind(ctx.actor.workspaceId, String(item.id)).all(),
      collaborationSnapshot(ctx, item),
    ]);
    return json({ item, variants: itemVariants, assets, activities: history.results,
      comments: collaboration.comments, approvals: collaboration.approvals,
      statusHistory: collaboration.statusHistory, currentApproval: collaboration.currentApproval,
      permissions: {
        manageAssets: canManageContentAssets(ctx.actor, item), manageVariants: canManageVariants(ctx.actor, item),
        uploadMedia: canUploadMedia(ctx.actor.role), approve: ["Owner", "Admin", "Approver"].includes(ctx.actor.role),
        ...collaboration.permissions,
      },
    });
  }
  if (resource === "content" && key && action === "variants" && method === "POST") {
    const item = await loadItem(ctx, idOf(key));
    if (!canManageVariants(ctx.actor, item)) deny();
    const input = variantInput(await jsonBody(request));
    try {
      const result = await ctx.db.prepare(`INSERT INTO content_platform_variants
        (workspace_id, content_id, platform, title, caption, description, hashtags, cta, notes, planned_publish_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(ctx.actor.workspaceId, item.id, input.platform, input.title, input.caption, input.description, input.hashtags, input.cta, input.notes, input.plannedPublishAt, input.status).run();
      const id = Number(result.meta.last_row_id);
      await activity(ctx, "platform_variant_created", "content", item.id, item.title, `${input.platform} version created.`, { variantId: id, platform: input.platform });
      const created = (await variants(ctx, item.id)).find(x => x.id === id);
      return json({ variant: created }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new HubError(`A ${input.platform} version already exists.`, 409);
      throw error;
    }
  }
  if (resource === "content" && key && action === "assets") {
    const item = await loadItem(ctx, idOf(key));
    if (!canManageContentAssets(ctx.actor, item)) deny();
    if (method === "POST" && !detail) {
      const input = await jsonBody(request);
      const asset = await loadMedia(ctx, idOf(input.mediaAssetId));
      const purpose = usage(input.usage);
      try {
        const result = await ctx.db.prepare(`INSERT INTO content_media_assets
          (workspace_id, content_id, media_asset_id, usage, position)
          VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM content_media_assets WHERE content_id = ?))`)
          .bind(ctx.actor.workspaceId, item.id, asset.id, purpose, item.id).run();
        await activity(ctx, "asset_attached", "content", item.id, item.title, `${asset.fileName} attached as ${purpose}.`, { assetId: asset.id, linkId: Number(result.meta.last_row_id) });
        return json({ assets: await contentAssets(ctx, item.id) }, 201);
      } catch (error) {
        if (String(error).includes("UNIQUE")) throw new HubError("This file is already attached to the Content.", 409);
        throw error;
      }
    }
    if (method === "PATCH" && detail === "reorder") {
      const input = await jsonBody(request);
      const current = await contentAssets(ctx, item.id);
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every(id => current.some(x => x.linkId === id))) throw new HubError("Refresh the asset list before reordering.", 409);
      if (ids.length) await ctx.db.batch(ids.map((id, position) => ctx.db.prepare("UPDATE content_media_assets SET position = ? WHERE workspace_id = ? AND content_id = ? AND id = ?").bind(position, ctx.actor.workspaceId, item.id, id)));
      await activity(ctx, "assets_reordered", "content", item.id, item.title, "Content assets reordered.");
      return json({ assets: await contentAssets(ctx, item.id) });
    }
    if (method === "DELETE" && detail) {
      const linkId = idOf(detail);
      const link = await ctx.db.prepare(`SELECT cma.id, m.id AS assetId, m.file_name AS fileName FROM content_media_assets cma
        JOIN media_assets m ON m.id = cma.media_asset_id WHERE cma.workspace_id = ? AND cma.content_id = ? AND cma.id = ?`)
        .bind(ctx.actor.workspaceId, item.id, linkId).first<{ id: number; assetId: number; fileName: string }>();
      if (!link) throw new HubError("Attached asset not found.", 404);
      await ctx.db.prepare("DELETE FROM content_media_assets WHERE workspace_id = ? AND content_id = ? AND id = ?").bind(ctx.actor.workspaceId, item.id, linkId).run();
      await activity(ctx, "asset_detached", "content", item.id, item.title, `${link.fileName} detached. The Media Library file was preserved.`, { assetId: link.assetId });
      return json({ assets: await contentAssets(ctx, item.id) });
    }
  }

  if (resource === "variants" && key) {
    const { variant, item } = await loadVariant(ctx, idOf(key));
    if (method === "PUT" && !action) {
      if (!canManageVariants(ctx.actor, item)) deny();
      const payload = await jsonBody(request);
      if (!Number.isInteger(payload.version) || payload.version !== variant.version) throw new HubError("This platform version changed. Refresh and try again.", 409);
      const input = variantInput(payload, variant);
      const result = await ctx.db.prepare(`UPDATE content_platform_variants SET platform = ?, title = ?, caption = ?, description = ?, hashtags = ?, cta = ?, notes = ?,
        planned_publish_at = ?, status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND id = ? AND version = ?`)
        .bind(input.platform, input.title, input.caption, input.description, input.hashtags, input.cta, input.notes, input.plannedPublishAt, input.status,
          ctx.actor.workspaceId, variant.id, variant.version).run();
      if (!result.meta.changes) throw new HubError("This platform version changed. Refresh and try again.", 409);
      await activity(ctx, "platform_variant_edited", "content", item.id, item.title, `${input.platform} version updated.`, { variantId: variant.id, platform: input.platform });
      return json({ variant: (await variants(ctx, item.id)).find(x => x.id === variant.id) });
    }
    if (method === "DELETE" && !action) {
      if (!canManageVariants(ctx.actor, item)) deny();
      await ctx.db.prepare("DELETE FROM content_platform_variants WHERE workspace_id = ? AND id = ?").bind(ctx.actor.workspaceId, variant.id).run();
      await activity(ctx, "platform_variant_deleted", "content", item.id, item.title, `${variant.platform} version deleted. Media Library files were preserved.`, { variantId: variant.id });
      return json({ deleted: true });
    }
    if (action === "assets") {
      if (!(canManageVariants(ctx.actor, item) || ctx.actor.role === "Designer" && item.assigneeId === ctx.actor.id)) deny();
      if (method === "POST" && !detail) {
        const input = await jsonBody(request);
        const asset = await loadMedia(ctx, idOf(input.mediaAssetId));
        const purpose = usage(input.usage);
        try {
          const result = await ctx.db.prepare(`INSERT INTO platform_variant_media_assets
            (workspace_id, variant_id, media_asset_id, usage, position)
            VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM platform_variant_media_assets WHERE variant_id = ?))`)
            .bind(ctx.actor.workspaceId, variant.id, asset.id, purpose, variant.id).run();
          await activity(ctx, "asset_attached", "content", item.id, item.title, `${asset.fileName} attached to ${variant.platform} as ${purpose}.`, { assetId: asset.id, variantId: variant.id, linkId: Number(result.meta.last_row_id) });
          return json({ assets: await variantAssets(ctx, variant.id) }, 201);
        } catch (error) {
          if (String(error).includes("UNIQUE")) throw new HubError("This file is already attached to the platform version.", 409);
          throw error;
        }
      }
      if (method === "DELETE" && detail) {
        const linkId = idOf(detail);
        const link = await ctx.db.prepare(`SELECT pvma.id, m.id AS assetId, m.file_name AS fileName FROM platform_variant_media_assets pvma
          JOIN media_assets m ON m.id = pvma.media_asset_id WHERE pvma.workspace_id = ? AND pvma.variant_id = ? AND pvma.id = ?`)
          .bind(ctx.actor.workspaceId, variant.id, linkId).first<{ id: number; assetId: number; fileName: string }>();
        if (!link) throw new HubError("Attached asset not found.", 404);
        await ctx.db.prepare("DELETE FROM platform_variant_media_assets WHERE workspace_id = ? AND variant_id = ? AND id = ?")
          .bind(ctx.actor.workspaceId, variant.id, linkId).run();
        await activity(ctx, "asset_detached", "content", item.id, item.title, `${link.fileName} detached from ${variant.platform}. The Media Library file was preserved.`, { assetId: link.assetId, variantId: variant.id });
        return json({ assets: await variantAssets(ctx, variant.id) });
      }
    }
  }

  return null;
}
