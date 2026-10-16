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
    `Detail` varchar(120) NULL,
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


CREATE TABLE `Notices` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `Code` varchar(24) NOT NULL,
    `DeviceName` varchar(60) NOT NULL,
    `MinerName` varchar(100) NULL,
    `Zone` varchar(100) NOT NULL,
    `CreatedBy` varchar(100) NOT NULL,
    `CreatedAt` datetime(6) NOT NULL,
    `ExpiresAt` datetime(6) NOT NULL,
    `DeliveredAt` datetime(6) NULL,
    `ReadAt` datetime(6) NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Notices_Code` CHECK (CHAR_LENGTH(`Code`) >= 1),
    CONSTRAINT `CK_Notices_Expiry` CHECK (`ExpiresAt` > `CreatedAt`),
    CONSTRAINT `CK_Notices_ReadAfterDelivery` CHECK (`ReadAt` IS NULL OR `DeliveredAt` IS NOT NULL),
    CONSTRAINT `FK_Notices_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE RESTRICT
);


CREATE TABLE `Readings` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `MinerName` varchar(100) NOT NULL,
    `DeviceName` varchar(60) NOT NULL,
    `Zone` varchar(100) NOT NULL,
    `TemperatureC` double NULL,
    `ObjectTemperatureC` double NULL,
    `GasPpm` double NULL,
    `GasVoltage` double NULL,
    `BatteryPercent` double NULL,
    `Level` varchar(16) NOT NULL,
    `Simulated` tinyint(1) NOT NULL,
    `ReceivedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_Readings_Battery` CHECK (`BatteryPercent` IS NULL OR `BatteryPercent` BETWEEN 0 AND 100),
    CONSTRAINT `CK_Readings_Gas` CHECK (`GasPpm` IS NULL OR `GasPpm` BETWEEN 0 AND 1000000),
    CONSTRAINT `CK_Readings_GasVoltage` CHECK (`GasVoltage` IS NULL OR `GasVoltage` BETWEEN 0 AND 5.5),
    CONSTRAINT `CK_Readings_Level` CHECK (`Level` IN ('normal', 'caution', 'danger')),
    CONSTRAINT `CK_Readings_Measurement` CHECK (`TemperatureC` IS NOT NULL OR `ObjectTemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `GasVoltage` IS NOT NULL OR `BatteryPercent` IS NOT NULL),
    CONSTRAINT `CK_Readings_ObjectTemperature` CHECK (`ObjectTemperatureC` IS NULL OR `ObjectTemperatureC` BETWEEN -70 AND 380),
    CONSTRAINT `CK_Readings_Temperature` CHECK (`TemperatureC` IS NULL OR `TemperatureC` BETWEEN -50 AND 150),
    CONSTRAINT `FK_Readings_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE CASCADE
);


CREATE TABLE `VoiceMessages` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `ClientMessageId` varchar(80) NOT NULL,
    `MinerName` varchar(100) NOT NULL,
    `DeviceName` varchar(60) NOT NULL,
    `Zone` varchar(100) NOT NULL,
    `RecordedAt` datetime(6) NOT NULL,
    `ReceivedAt` datetime(6) NOT NULL,
    `DurationMs` int NOT NULL,
    `SampleRate` int NOT NULL,
    `SizeBytes` bigint NOT NULL,
    `StoragePath` varchar(260) NOT NULL,
    `ReviewedAt` datetime(6) NULL,
    `ReviewedBy` varchar(100) NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `CK_VoiceMessages_ClientMessageId` CHECK (CHAR_LENGTH(`ClientMessageId`) >= 1),
    CONSTRAINT `CK_VoiceMessages_Duration` CHECK (`DurationMs` > 0),
    CONSTRAINT `CK_VoiceMessages_Review` CHECK ((`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)),
    CONSTRAINT `CK_VoiceMessages_Size` CHECK (`SizeBytes` > 0),
    CONSTRAINT `FK_VoiceMessages_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE RESTRICT
);


CREATE UNIQUE INDEX `IX_Devices_KeyHash` ON `Devices` (`KeyHash`);


CREATE UNIQUE INDEX `IX_Devices_Name` ON `Devices` (`Name`);


CREATE INDEX `IX_Devices_UserId` ON `Devices` (`UserId`);


CREATE UNIQUE INDEX `IX_Messages_DeviceId_ClientMessageId` ON `Messages` (`DeviceId`, `ClientMessageId`);


CREATE INDEX `IX_Messages_ReceivedAt` ON `Messages` (`ReceivedAt`);


CREATE INDEX `IX_Notices_DeviceId_ReadAt` ON `Notices` (`DeviceId`, `ReadAt`);


CREATE INDEX `IX_Notices_ExpiresAt` ON `Notices` (`ExpiresAt`);


CREATE INDEX `IX_Readings_DeviceId_ReceivedAt` ON `Readings` (`DeviceId`, `ReceivedAt`);


CREATE INDEX `IX_Readings_MinerName_ReceivedAt` ON `Readings` (`MinerName`, `ReceivedAt`);


CREATE INDEX `IX_Readings_ReceivedAt` ON `Readings` (`ReceivedAt`);


CREATE INDEX `IX_Readings_Zone_ReceivedAt` ON `Readings` (`Zone`, `ReceivedAt`);


CREATE UNIQUE INDEX `IX_Users_Email` ON `Users` (`Email`);


CREATE UNIQUE INDEX `IX_VoiceMessages_DeviceId_ClientMessageId` ON `VoiceMessages` (`DeviceId`, `ClientMessageId`);


CREATE INDEX `IX_VoiceMessages_ReceivedAt` ON `VoiceMessages` (`ReceivedAt`);


-- Políticas de tabla (triggers creados por las migraciones)
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
        OR NOT (NEW.`Detail` <=> OLD.`Detail`)
        OR NOT (NEW.`MinerName` <=> OLD.`MinerName`) OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`SentAt` <=> OLD.`SentAt`)
        OR NOT (NEW.`ReceivedAt` <=> OLD.`ReceivedAt`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un mensaje solo admite registrar su revisión, y una sola vez.';
    END IF;
END$$

CREATE TRIGGER `TR_Notices_NoDelete` BEFORE DELETE ON `Notices` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los avisos no se eliminan.'$$

CREATE TRIGGER `TR_Notices_StatusOnly` BEFORE UPDATE ON `Notices` FOR EACH ROW
BEGIN
    IF NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`) OR NOT (NEW.`Code` <=> OLD.`Code`)
        OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`) OR NOT (NEW.`MinerName` <=> OLD.`MinerName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`CreatedBy` <=> OLD.`CreatedBy`)
        OR NOT (NEW.`CreatedAt` <=> OLD.`CreatedAt`) OR NOT (NEW.`ExpiresAt` <=> OLD.`ExpiresAt`)
        OR (OLD.`DeliveredAt` IS NOT NULL AND NOT (NEW.`DeliveredAt` <=> OLD.`DeliveredAt`))
        OR (OLD.`ReadAt` IS NOT NULL AND NOT (NEW.`ReadAt` <=> OLD.`ReadAt`)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un aviso solo admite registrar su entrega y su lectura, una sola vez.';
    END IF;
END$$

CREATE TRIGGER `TR_Readings_NoDelete` BEFORE DELETE ON `Readings` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'$$

CREATE TRIGGER `TR_Readings_NoUpdate` BEFORE UPDATE ON `Readings` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'$$

CREATE TRIGGER `TR_Users_NoDelete` BEFORE DELETE ON `Users` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las cuentas se desactivan; no se eliminan.'$$

CREATE TRIGGER `TR_VoiceMessages_NoDelete` BEFORE DELETE ON `VoiceMessages` FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los mensajes de voz no se eliminan.'$$

CREATE TRIGGER `TR_VoiceMessages_ReviewOnly` BEFORE UPDATE ON `VoiceMessages` FOR EACH ROW
BEGIN
    IF OLD.`ReviewedAt` IS NOT NULL OR NEW.`ReviewedAt` IS NULL
        OR NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`)
        OR NOT (NEW.`ClientMessageId` <=> OLD.`ClientMessageId`) OR NOT (NEW.`MinerName` <=> OLD.`MinerName`)
        OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`) OR NOT (NEW.`Zone` <=> OLD.`Zone`)
        OR NOT (NEW.`RecordedAt` <=> OLD.`RecordedAt`) OR NOT (NEW.`ReceivedAt` <=> OLD.`ReceivedAt`)
        OR NOT (NEW.`DurationMs` <=> OLD.`DurationMs`) OR NOT (NEW.`SampleRate` <=> OLD.`SampleRate`)
        OR NOT (NEW.`SizeBytes` <=> OLD.`SizeBytes`) OR NOT (NEW.`StoragePath` <=> OLD.`StoragePath`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un mensaje de voz solo admite registrar que fue escuchado, una sola vez.';
    END IF;
END$$

DELIMITER ;
