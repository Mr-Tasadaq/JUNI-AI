CREATE TABLE `conversations` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `conversations_owner_updated_idx` ON `conversations` (`ownerId`,`updatedAt`);
--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversationId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `messages_owner_conversation_idx` ON `messages` (`ownerId`,`conversationId`,`createdAt`);
