import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().default(""),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  ownerUserId: text("owner_user_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  initialized: integer("initialized").notNull().default(0),
  modelVersion: integer("model_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)]);

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("Viewer"),
  status: text("status").notNull().default("Invited"),
});

export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  slug: text("slug").notNull(),
  logo: text("logo").notNull().default(""),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("brands_workspace_slug_unique").on(table.workspaceId, table.slug),
  index("idx_brands_workspace_archived").on(table.workspaceId, table.archived),
]);

export const pillars = sqliteTable("pillars", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  objective: text("objective").notNull().default(""),
  color: text("color").notNull().default("#2563eb"),
  active: integer("active").notNull().default(1),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("idx_pillars_workspace_position").on(table.workspaceId, table.position),
  index("idx_pillars_brand_position").on(table.brandId, table.position),
]);

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  objective: text("objective").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""),
  ownerMemberId: integer("owner_member_id").references(() => members.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Draft"),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("campaigns_brand_name_unique").on(table.brandId, table.name),
  index("idx_campaigns_workspace_status").on(table.workspaceId, table.status),
]);

export const contentItems = sqliteTable("content_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  workspaceId: text("workspace_id").notNull().default("main"),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: "restrict" }),
  brand: text("brand").notNull().default("Creative Hub"),
  campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  campaign: text("campaign").notNull().default(""),
  pillarId: integer("pillar_id").references(() => pillars.id, { onDelete: "set null" }),
  pillar: text("pillar").notNull(),
  title: text("title").notNull(),
  objective: text("objective").notNull().default(""),
  brief: text("brief").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  keyMessage: text("key_message").notNull().default(""),
  contentDirection: text("content_direction").notNull().default(""),
  references: text("references").notNull().default(""),
  format: text("format").notNull().default("Post"),
  priority: text("priority").notNull().default("Normal"),
  assigneeId: integer("assignee_id"),
  pic: text("pic").notNull(),
  creatorMemberId: integer("creator_member_id").references(() => members.id, { onDelete: "set null" }),
  deadline: text("deadline").notNull().default(""),
  publishDate: text("publish_date").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("Idea"),
  caption: text("caption").notNull().default(""),
  copyHook: text("copy_hook").notNull().default(""),
  copyCta: text("copy_cta").notNull().default(""),
  copyNotes: text("copy_notes").notNull().default(""),
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  reviewDecision: text("review_decision").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_content_items_owner_date").on(table.ownerId, table.publishDate),
  index("idx_content_items_owner_status").on(table.ownerId, table.status),
  index("idx_content_items_workspace_status").on(table.workspaceId, table.status),
  index("idx_content_items_workspace_publish").on(table.workspaceId, table.publishDate),
  index("idx_content_items_brand_campaign").on(table.brandId, table.campaignId),
]);

export const activityHistory = sqliteTable("activity_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  actorMemberId: integer("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entityTitle: text("entity_title").notNull(),
  summary: text("summary").notNull().default(""),
  context: text("context").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_activity_workspace_created").on(table.workspaceId, table.createdAt)]);

export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  contentId: integer("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  authorMemberId: integer("author_member_id").references(() => members.id, { onDelete: "set null" }),
  parentId: integer("parent_id").references((): AnySQLiteColumn => comments.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  resolved: integer("resolved").notNull().default(0),
  resolvedByMemberId: integer("resolved_by_member_id").references(() => members.id, { onDelete: "set null" }),
  resolvedAt: text("resolved_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_comments_workspace_content_created").on(table.workspaceId, table.contentId, table.createdAt),
  index("idx_comments_parent").on(table.parentId),
]);

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  contentId: integer("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  requestedByMemberId: integer("requested_by_member_id").references(() => members.id, { onDelete: "set null" }),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  status: text("status").notNull().default("pending"),
  contentVersion: integer("content_version").notNull(),
  submissionNote: text("submission_note").notNull().default(""),
  decisionByMemberId: integer("decision_by_member_id").references(() => members.id, { onDelete: "set null" }),
  decisionNote: text("decision_note").notNull().default(""),
  decidedAt: text("decided_at").notNull().default(""),
}, (table) => [
  index("idx_approvals_workspace_status_requested").on(table.workspaceId, table.status, table.requestedAt),
  index("idx_approvals_content_requested").on(table.contentId, table.requestedAt),
  uniqueIndex("approvals_one_pending_per_content").on(table.contentId).where(sql`${table.status} = 'pending'`),
]);

export const contentStatusHistory = sqliteTable("content_status_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  contentId: integer("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  actorMemberId: integer("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_content_status_history_content_created").on(table.contentId, table.createdAt),
  index("idx_content_status_history_workspace_created").on(table.workspaceId, table.createdAt),
]);

export const mediaAssets = sqliteTable("media_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: integer("duration_seconds"),
  uploaderMemberId: integer("uploader_member_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("media_assets_storage_key_unique").on(table.storageKey),
  index("idx_media_assets_workspace_created").on(table.workspaceId, table.createdAt),
  index("idx_media_assets_workspace_kind").on(table.workspaceId, table.kind),
]);

export const contentPlatformVariants = sqliteTable("content_platform_variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  contentId: integer("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  title: text("title").notNull().default(""),
  caption: text("caption").notNull().default(""),
  description: text("description").notNull().default(""),
  hashtags: text("hashtags").notNull().default(""),
  cta: text("cta").notNull().default(""),
  notes: text("notes").notNull().default(""),
  plannedPublishAt: text("planned_publish_at").notNull().default(""),
  status: text("status").notNull().default("Idea"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("platform_variants_content_platform_unique").on(table.contentId, table.platform),
  index("idx_platform_variants_workspace_content").on(table.workspaceId, table.contentId),
]);

export const contentMediaAssets = sqliteTable("content_media_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  contentId: integer("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  mediaAssetId: integer("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  usage: text("usage").notNull().default("Supporting Asset"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("content_media_assets_unique").on(table.contentId, table.mediaAssetId),
  index("idx_content_media_assets_content_position").on(table.contentId, table.position),
]);

export const platformVariantMediaAssets = sqliteTable("platform_variant_media_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  variantId: integer("variant_id").notNull().references(() => contentPlatformVariants.id, { onDelete: "cascade" }),
  mediaAssetId: integer("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  usage: text("usage").notNull().default("Supporting Asset"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("platform_variant_media_assets_unique").on(table.variantId, table.mediaAssetId),
  index("idx_variant_media_assets_variant_position").on(table.variantId, table.position),
]);

// Retained for one-way migration compatibility. New code uses brands and campaigns.
export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});
