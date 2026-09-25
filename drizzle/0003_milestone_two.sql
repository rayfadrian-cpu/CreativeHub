CREATE TABLE `content_media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`media_asset_id` integer NOT NULL,
	`usage` text DEFAULT 'Supporting Asset' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_media_assets_unique` ON `content_media_assets` (`content_id`,`media_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_content_media_assets_content_position` ON `content_media_assets` (`content_id`,`position`);--> statement-breakpoint
CREATE TABLE `content_platform_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`platform` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`hashtags` text DEFAULT '' NOT NULL,
	`cta` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`planned_publish_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Idea' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_variants_content_platform_unique` ON `content_platform_variants` (`content_id`,`platform`);--> statement-breakpoint
CREATE INDEX `idx_platform_variants_workspace_content` ON `content_platform_variants` (`workspace_id`,`content_id`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`file_name` text NOT NULL,
	`original_name` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_seconds` integer,
	`uploader_member_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`uploader_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_storage_key_unique` ON `media_assets` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_media_assets_workspace_created` ON `media_assets` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_media_assets_workspace_kind` ON `media_assets` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `platform_variant_media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`variant_id` integer NOT NULL,
	`media_asset_id` integer NOT NULL,
	`usage` text DEFAULT 'Supporting Asset' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `content_platform_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_variant_media_assets_unique` ON `platform_variant_media_assets` (`variant_id`,`media_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_variant_media_assets_variant_position` ON `platform_variant_media_assets` (`variant_id`,`position`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `key_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `content_direction` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `references` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `copy_hook` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `copy_cta` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `copy_notes` text DEFAULT '' NOT NULL;