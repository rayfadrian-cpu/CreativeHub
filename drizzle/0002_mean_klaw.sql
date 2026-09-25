CREATE TABLE `activity_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_member_id` integer,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE restrict,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_activity_workspace_created` ON `activity_history` (`workspace_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`slug` text NOT NULL,
	`logo` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_workspace_slug_unique` ON `brands` (`workspace_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `idx_brands_workspace_archived` ON `brands` (`workspace_id`,`archived`);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`target_audience` text DEFAULT '' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`owner_member_id` integer,
	`status` text DEFAULT 'Draft' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE restrict,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE restrict,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_brand_name_unique` ON `campaigns` (`brand_id`,`name`);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_workspace_status` ON `campaigns` (`workspace_id`,`status`);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `brand_id` integer REFERENCES brands(id);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `campaign_id` integer REFERENCES campaigns(id);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `objective` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD `brief` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD `target_audience` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD `format` text DEFAULT 'Post' NOT NULL;
--> statement-breakpoint
ALTER TABLE `content_items` ADD `creator_member_id` integer REFERENCES members(id);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `deadline` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_content_items_workspace_publish` ON `content_items` (`workspace_id`,`publish_date`);
--> statement-breakpoint
CREATE INDEX `idx_content_items_brand_campaign` ON `content_items` (`brand_id`,`campaign_id`);
--> statement-breakpoint
ALTER TABLE `pillars` ADD `brand_id` integer REFERENCES brands(id);
--> statement-breakpoint
ALTER TABLE `pillars` ADD `created_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `pillars` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_pillars_brand_position` ON `pillars` (`brand_id`,`position`);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `slug` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `timezone` text DEFAULT 'Asia/Jakarta' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `model_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `created_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);
--> statement-breakpoint
PRAGMA optimize;
