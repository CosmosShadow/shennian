-- Preserve the exact-one-target invariant without combining a CHECK expression
-- with cascading foreign keys, which MySQL 8 and MariaDB reject.
-- Cascading updates preserve nullness; cascading deletes remove the whole row.
CREATE TRIGGER `UserContact_exact_target_insert`
BEFORE INSERT ON `UserContact`
FOR EACH ROW
BEGIN
  IF (NEW.`targetUserId` IS NULL) = (NEW.`targetAgentIdentityId` IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UserContact_exact_target_check';
  END IF;
END;

CREATE TRIGGER `UserContact_exact_target_update`
BEFORE UPDATE ON `UserContact`
FOR EACH ROW
BEGIN
  IF (NEW.`targetUserId` IS NULL) = (NEW.`targetAgentIdentityId` IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UserContact_exact_target_check';
  END IF;
END;

INSERT INTO `ConversationWriteControl` (`name`, `mode`, `everCanonical`, `updatedAt`)
VALUES ('published_ai', 'legacy', false, CURRENT_TIMESTAMP(3));
