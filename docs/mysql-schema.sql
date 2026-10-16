CREATE TABLE `Events` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `Actor` varchar(100) NOT NULL,
    `Description` varchar(500) NOT NULL,
    `CreatedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`)
);


CREATE TABLE `Users` (
    `Id` varchar(32) NOT NULL,
    `Name` varchar(100) NOT NULL,
    `Email` varchar(180) NOT NULL,
    `Role` varchar(16) NOT NULL,
    `Active` tinyint(1) NOT NULL,
    `PasswordHash` varchar(512) NOT NULL,
    `SessionVersion` varchar(32) NOT NULL,
    `CreatedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Users_Email` CHECK (`Email` LIKE '%_@_%'),
    CONSTRAINT `CK_Users_Name` CHECK (CHAR_LENGTH(TRIM(`Name`)) >= 2),
    CONSTRAINT `CK_Users_Role` CHECK (`Role` IN ('Admin', 'Supervisor', 'Miner'))
);


CREATE TABLE `Devices` (
    `Id` varchar(32) NOT NULL,
    `Name` varchar(60) NOT NULL,
    `Zone` varchar(100) NOT NULL,
    `UserId` varchar(32) NULL,
    `KeyHash` varchar(64) NOT NULL,
    `Active` tinyint(1) NOT NULL,
    `LastSeenAt` datetime(6) NULL,
    `CreatedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Devices_KeyHash` CHECK (CHAR_LENGTH(`KeyHash`) = 64),
    CONSTRAINT `CK_Devices_Name` CHECK (CHAR_LENGTH(TRIM(`Name`)) >= 2),
    CONSTRAINT `CK_Devices_Zone` CHECK (CHAR_LENGTH(TRIM(`Zone`)) >= 2),
    CONSTRAINT `FK_Devices_Users_UserId` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
);


CREATE TABLE `Messages` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `ClientMessageId` varchar(80) NOT NULL,
    `Code` varchar(16) NOT NULL,
    `MinerName` varchar(100) NOT NULL,
    `DeviceName` varchar(60) NOT NULL,
    `Zone` varchar(100) NOT NULL,
    `SentAt` datetime(6) NOT NULL,
    `ReceivedAt` datetime(6) NOT NULL,
    `ReviewedAt` datetime(6) NULL,
    `ReviewedBy` varchar(100) NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Messages_ClientMessageId` CHECK (CHAR_LENGTH(`ClientMessageId`) >= 1),
    CONSTRAINT `CK_Messages_Review` CHECK ((`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)),
    CONSTRAINT `FK_Messages_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE CASCADE
);


CREATE TABLE `Readings` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `MinerName` varchar(100) NOT NULL,
    `DeviceName` varchar(60) NOT NULL,
    `Zone` varchar(100) NOT NULL,
    `TemperatureC` double NULL,
    `GasPpm` double NULL,
    `BatteryPercent` double NULL,
    `ReceivedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Readings_Battery` CHECK (`BatteryPercent` IS NULL OR `BatteryPercent` BETWEEN 0 AND 100),
    CONSTRAINT `CK_Readings_Gas` CHECK (`GasPpm` IS NULL OR `GasPpm` BETWEEN 0 AND 1000000),
    CONSTRAINT `CK_Readings_Measurement` CHECK (`TemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `BatteryPercent` IS NOT NULL),
    CONSTRAINT `CK_Readings_Temperature` CHECK (`TemperatureC` IS NULL OR `TemperatureC` BETWEEN -50 AND 150),
    CONSTRAINT `FK_Readings_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE CASCADE
);


CREATE UNIQUE INDEX `IX_Devices_KeyHash` ON `Devices` (`KeyHash`);


CREATE UNIQUE INDEX `IX_Devices_Name` ON `Devices` (`Name`);


CREATE INDEX `IX_Devices_UserId` ON `Devices` (`UserId`);


CREATE UNIQUE INDEX `IX_Messages_DeviceId_ClientMessageId` ON `Messages` (`DeviceId`, `ClientMessageId`);


CREATE INDEX `IX_Messages_ReceivedAt` ON `Messages` (`ReceivedAt`);


CREATE INDEX `IX_Readings_DeviceId_ReceivedAt` ON `Readings` (`DeviceId`, `ReceivedAt`);


CREATE INDEX `IX_Readings_MinerName_ReceivedAt` ON `Readings` (`MinerName`, `ReceivedAt`);


CREATE INDEX `IX_Readings_ReceivedAt` ON `Readings` (`ReceivedAt`);


CREATE INDEX `IX_Readings_Zone_ReceivedAt` ON `Readings` (`Zone`, `ReceivedAt`);


CREATE UNIQUE INDEX `IX_Users_Email` ON `Users` (`Email`);


-- Políticas de tabla (migración AddDatabaseSecurityPolicies)
DELIMITER $$

CREATE TRIGGER `TR_Devices_NoDelete` BEFORE DELETE ON `Devices` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las manillas se desactivan; no se eliminan.'$$

CREATE TRIGGER `TR_Events_NoDelete` BEFORE DELETE ON `Events` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La auditoría solo admite inserciones.'$$

CREATE TRIGGER `TR_Events_NoUpdate` BEFORE UPDATE ON `Events` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La auditoría solo admite inserciones.'$$

CREATE TRIGGER `TR_Messages_NoDelete` BEFORE DELETE ON `Messages` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los mensajes no se eliminan.'$$

CREATE TRIGGER `TR_Messages_ReviewOnly` BEFORE UPDATE ON `Messages` FOR EACH ROW
BEGIN
    IF OLD.`ReviewedAt` IS NOT NULL OR NEW.`ReviewedAt` IS NULL
        OR NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`)
        OR NOT (NEW.`ClientMessageId` <=> OLD.`ClientMessageId`) OR NOT (NEW.`Code` <=> OLD.`Code`)
        OR NOT (NEW.`MinerName` <=> OLD.`MinerName`) OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`SentAt` <=> OLD.`SentAt`)
        OR NOT (NEW.`ReceivedAt` <=> OLD.`ReceivedAt`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un mensaje solo admite registrar su revisión, y una sola vez.';
    END IF;
END$$

CREATE TRIGGER `TR_Readings_NoDelete` BEFORE DELETE ON `Readings` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'$$

CREATE TRIGGER `TR_Readings_NoUpdate` BEFORE UPDATE ON `Readings` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'$$

CREATE TRIGGER `TR_Users_NoDelete` BEFORE DELETE ON `Users` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las cuentas se desactivan; no se eliminan.'$$

DELIMITER ;
