ALTER TABLE `content_media_assets` ADD `alt_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_platform_variants` ADD `publish_format` text DEFAULT 'Single image' NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_variant_media_assets` ADD `alt_text` text DEFAULT '' NOT NULL;