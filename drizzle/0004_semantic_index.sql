CREATE TABLE `semanticChunks` (
	`id` varchar(64) NOT NULL,
	`ownerId` int NOT NULL,
	`sourceType` enum('conversation_message') NOT NULL,
	`sourceId` varchar(36) NOT NULL,
	`chunkIndex` int NOT NULL,
	`content` text NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`embedding` json NOT NULL,
	`embeddingModel` varchar(128) NOT NULL,
	`embeddingDimensions` int NOT NULL,
	`distanceMetric` enum('cosine') NOT NULL DEFAULT 'cosine',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `semanticChunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `semantic_chunks_owner_source_chunk_uq` UNIQUE(`ownerId`,`sourceType`,`sourceId`,`chunkIndex`),
	INDEX `semantic_chunks_owner_created_idx` (`ownerId`,`createdAt`),
	INDEX `semantic_chunks_owner_source_idx` (`ownerId`,`sourceType`,`sourceId`)
);
