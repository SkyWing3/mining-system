-- Read-only account for exposure analysis. Run as root after the API has applied its migrations:
--   mysql -u root -p mining_system --init-command="SET @analyst_password='...'" < infra/mysql/analyst-account.sql
-- It can read readings and messages, plus non-sensitive columns of users and devices;
-- it never sees e-mails, password hashes, session versions or device credential hashes.
SET @statement = CONCAT('CREATE USER IF NOT EXISTS ''mining_analyst''@''%'' IDENTIFIED BY ', QUOTE(@analyst_password));
PREPARE create_analyst FROM @statement;
EXECUTE create_analyst;
DEALLOCATE PREPARE create_analyst;

GRANT SELECT ON `Readings` TO 'mining_analyst'@'%';
GRANT SELECT ON `Messages` TO 'mining_analyst'@'%';
GRANT SELECT (`Id`, `Name`, `Role`, `Active`, `CreatedAt`) ON `Users` TO 'mining_analyst'@'%';
GRANT SELECT (`Id`, `Name`, `Zone`, `UserId`, `Active`, `LastSeenAt`, `CreatedAt`) ON `Devices` TO 'mining_analyst'@'%';
