CREATE TABLE `content_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`publish_date` text NOT NULL,
	`pillar` text NOT NULL,
	`campaign` text DEFAULT '' NOT NULL,
	`platform` text NOT NULL,
	`pic` text NOT NULL,
	`status` text DEFAULT 'Idea' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_content_items_owner_date` ON `content_items` (`owner_id`,`publish_date`);--> statement-breakpoint
CREATE INDEX `idx_content_items_owner_status` ON `content_items` (`owner_id`,`status`);