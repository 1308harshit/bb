CREATE INDEX IF NOT EXISTS `threads_list_created_idx` ON `threads` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `threads_list_updated_idx` ON `threads` (`updated_at`,`id`);