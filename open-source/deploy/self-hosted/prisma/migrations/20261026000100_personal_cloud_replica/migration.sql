-- Generated schema diff; normalize the UTC DATETIME literal for MySQL / MariaDB.
-- AlterTable
ALTER TABLE `NianSession` ADD COLUMN `cloudBodyNextAttemptAt` DATETIME(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
    ADD COLUMN `cloudBodyRevision` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `PersonalSessionCloudMutation` (
    `sessionId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `dataEpoch` INTEGER NOT NULL,
    `daemonInstallationId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,

    PRIMARY KEY (`sessionId`, `revision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `NianSession_cloudBodyNextAttemptAt_idx` ON `NianSession`(`cloudBodyNextAttemptAt`);

-- AddForeignKey
ALTER TABLE `PersonalSessionCloudMutation` ADD CONSTRAINT `PersonalSessionCloudMutation_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `NianSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
