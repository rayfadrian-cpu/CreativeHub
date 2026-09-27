CREATE TABLE `publish_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`platform` text NOT NULL,
	`account_label` text DEFAULT 'Not connected' NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`locked_at` text DEFAULT '' NOT NULL,
	`last_error_code` text DEFAULT '' NOT NULL,
	`last_error_message` text DEFAULT '' NOT NULL,
	`created_by_member_id` integer,
	`cancelled_by_member_id` integer,
	`external_post_id` text DEFAULT '' NOT NULL,
	`external_post_url` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `content_platform_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_workspace_status_schedule` ON `publish_jobs` (`workspace_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_content` ON `publish_jobs` (`content_id`);--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_variant` ON `publish_jobs` (`variant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publish_jobs_one_active_per_variant` ON `publish_jobs` (`variant_id`) WHERE "publish_jobs"."status" IN ('scheduled', 'queued', 'processing', 'retrying', 'blocked');--> statement-breakpoint
CREATE TABLE `publish_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`publish_job_id` integer NOT NULL,
	`content_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`platform` text NOT NULL,
	`account_label` text DEFAULT 'Not connected' NOT NULL,
	`attempt_number` integer NOT NULL,
	`request_at` text NOT NULL,
	`response_at` text NOT NULL,
	`status` text NOT NULL,
	`external_post_id` text DEFAULT '' NOT NULL,
	`external_post_url` text DEFAULT '' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`publish_job_id`) REFERENCES `publish_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `content_platform_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_publish_logs_workspace_created` ON `publish_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_publish_logs_job_attempt` ON `publish_logs` (`publish_job_id`,`attempt_number`);