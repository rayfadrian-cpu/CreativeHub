import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

// Retained for one-way migration compatibility. New code uses brands and campaigns.
export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
});
