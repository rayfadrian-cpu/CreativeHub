CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'Viewer' NOT NULL,
	`status` text DEFAULT 'Invited' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `pillars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#2563eb' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pillars_workspace_position` ON `pillars` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `workspace_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `brand` text DEFAULT 'Creative Hub' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `priority` text DEFAULT 'Normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `assignee_id` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `pillar_id` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `review_decision` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_content_items_workspace_status` ON `content_items` (`workspace_id`,`status`);