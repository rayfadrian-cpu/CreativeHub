import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const contentItems = sqliteTable(
  "content_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
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
  ],
);
