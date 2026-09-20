import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const contentItems = sqliteTable(
  "content_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id").notNull().default("main"),
    brand: text("brand").notNull().default("Creative Hub"),
    priority: text("priority").notNull().default("Normal"),
    assigneeId: integer("assignee_id"),
    pillarId: integer("pillar_id"),
    version: integer("version").notNull().default(1),
    reviewDecision: text("review_decision").notNull().default(""),
    title: text("title").notNull(),
    publishDate: text("publish_date").notNull(),
    pillar: text("pillar").notNull(),
    campaign: text("campaign").notNull().default(""),
    platform: text("platform").notNull(),
    pic: text("pic").notNull(),
    status: text("status").notNull().default("Idea"),
    caption: text("caption").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_content_items_owner_date").on(table.ownerId, table.publishDate),
    index("idx_content_items_owner_status").on(table.ownerId, table.status),
    index("idx_content_items_workspace_status").on(table.workspaceId, table.status),
  ],
);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(), ownerEmail: text("owner_email").notNull(),
  initialized: integer("initialized").notNull().default(0),
});
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(), userId: text("user_id"),
  name: text("name").notNull(), email: text("email").notNull().unique(),
  role: text("role").notNull().default("Viewer"), status: text("status").notNull().default("Invited"),
});
export const pillars = sqliteTable("pillars", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(), name: text("name").notNull(),
  description: text("description").notNull().default(""), objective: text("objective").notNull().default(""),
  color: text("color").notNull().default("#2563eb"), active: integer("active").notNull().default(1),
  position: integer("position").notNull().default(0),
}, (table) => [index("idx_pillars_workspace_position").on(table.workspaceId, table.position)]);
export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }), workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(), name: text("name").notNull(), description: text("description").notNull().default(""),
});
