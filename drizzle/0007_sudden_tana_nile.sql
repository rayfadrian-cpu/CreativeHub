CREATE TABLE `social_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`account_type` text DEFAULT '' NOT NULL,
	`profile_picture_url` text DEFAULT '' NOT NULL,
	`token_ciphertext` text NOT NULL,
	`token_iv` text NOT NULL,
	`token_expires_at` text DEFAULT '' NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_verified_at` text DEFAULT '' NOT NULL,
	`last_error_code` text DEFAULT '' NOT NULL,
	`last_error_message` text DEFAULT '' NOT NULL,
	`connected_by_member_id` integer,
	`disconnected_by_member_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connected_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`disconnected_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_accounts_workspace_platform_provider_unique` ON `social_accounts` (`workspace_id`,`platform`,`provider_account_id`);--> statement-breakpoint
CREATE INDEX `idx_social_accounts_workspace_platform_status` ON `social_accounts` (`workspace_id`,`platform`,`status`);--> statement-breakpoint
CREATE TABLE `social_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` integer NOT NULL,
	`return_to` text DEFAULT '/#publishing' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_social_oauth_states_expiry` ON `social_oauth_states` (`expires_at`);--> statement-breakpoint
ALTER TABLE `publish_jobs` ADD `social_account_id` integer REFERENCES social_accounts(id);--> statement-breakpoint
ALTER TABLE `publish_jobs` ADD `provider_container_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_social_account` ON `publish_jobs` (`social_account_id`);