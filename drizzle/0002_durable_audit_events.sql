CREATE TABLE `auditEvents` (
	`id` varchar(36) NOT NULL,
	`actorUserId` int NOT NULL,
	`action` varchar(128) NOT NULL,
	`targetUserId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`metadata` json NOT NULL,
	CONSTRAINT `auditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `auditEvents` (`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `auditEvents` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `auditEvents` (`action`,`occurredAt`);
