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
    PRIMARY KEY (`Id`)
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
    CONSTRAINT `FK_Messages_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE CASCADE
);


CREATE TABLE `Readings` (
    `Id` bigint NOT NULL AUTO_INCREMENT,
    `DeviceId` varchar(32) NOT NULL,
    `TemperatureC` double NULL,
    `GasPpm` double NULL,
    `BatteryPercent` double NULL,
    `ReceivedAt` datetime(6) NOT NULL,
    PRIMARY KEY (`Id`),
    CONSTRAINT `FK_Readings_Devices_DeviceId` FOREIGN KEY (`DeviceId`) REFERENCES `Devices` (`Id`) ON DELETE CASCADE
);


CREATE UNIQUE INDEX `IX_Devices_KeyHash` ON `Devices` (`KeyHash`);


CREATE UNIQUE INDEX `IX_Devices_Name` ON `Devices` (`Name`);


CREATE INDEX `IX_Devices_UserId` ON `Devices` (`UserId`);


CREATE UNIQUE INDEX `IX_Messages_DeviceId_ClientMessageId` ON `Messages` (`DeviceId`, `ClientMessageId`);


CREATE INDEX `IX_Messages_ReceivedAt` ON `Messages` (`ReceivedAt`);


CREATE INDEX `IX_Readings_DeviceId_ReceivedAt` ON `Readings` (`DeviceId`, `ReceivedAt`);


CREATE UNIQUE INDEX `IX_Users_Email` ON `Users` (`Email`);


