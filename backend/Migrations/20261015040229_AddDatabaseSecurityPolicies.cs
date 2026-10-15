using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddDatabaseSecurityPolicies : Migration
    {
        // Row policies that MySQL lacks natively (no RLS): history is append-only.
        private static readonly (string Name, string Sql)[] Policies =
        [
            ("TR_Events_NoUpdate", "CREATE TRIGGER `TR_Events_NoUpdate` BEFORE UPDATE ON `Events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La auditoría solo admite inserciones.'"),
            ("TR_Events_NoDelete", "CREATE TRIGGER `TR_Events_NoDelete` BEFORE DELETE ON `Events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La auditoría solo admite inserciones.'"),
            ("TR_Readings_NoUpdate", "CREATE TRIGGER `TR_Readings_NoUpdate` BEFORE UPDATE ON `Readings` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'"),
            ("TR_Readings_NoDelete", "CREATE TRIGGER `TR_Readings_NoDelete` BEFORE DELETE ON `Readings` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las lecturas solo admiten inserciones.'"),
            ("TR_Messages_NoDelete", "CREATE TRIGGER `TR_Messages_NoDelete` BEFORE DELETE ON `Messages` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los mensajes no se eliminan.'"),
            ("TR_Messages_ReviewOnly", @"CREATE TRIGGER `TR_Messages_ReviewOnly` BEFORE UPDATE ON `Messages` FOR EACH ROW
BEGIN
    IF OLD.`ReviewedAt` IS NOT NULL OR NEW.`ReviewedAt` IS NULL
        OR NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`)
        OR NOT (NEW.`ClientMessageId` <=> OLD.`ClientMessageId`) OR NOT (NEW.`Code` <=> OLD.`Code`)
        OR NOT (NEW.`MinerName` <=> OLD.`MinerName`) OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`SentAt` <=> OLD.`SentAt`)
        OR NOT (NEW.`ReceivedAt` <=> OLD.`ReceivedAt`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un mensaje solo admite registrar su revisión, y una sola vez.';
    END IF;
END"),
            ("TR_Users_NoDelete", "CREATE TRIGGER `TR_Users_NoDelete` BEFORE DELETE ON `Users` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las cuentas se desactivan; no se eliminan.'"),
            ("TR_Devices_NoDelete", "CREATE TRIGGER `TR_Devices_NoDelete` BEFORE DELETE ON `Devices` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las manillas se desactivan; no se eliminan.'"),
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Email",
                table: "Users",
                sql: "`Email` LIKE '%_@_%'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Name",
                table: "Users",
                sql: "CHAR_LENGTH(TRIM(`Name`)) >= 2");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "`Role` IN ('Admin', 'Supervisor', 'Miner')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Battery",
                table: "Readings",
                sql: "`BatteryPercent` IS NULL OR `BatteryPercent` BETWEEN 0 AND 100");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Gas",
                table: "Readings",
                sql: "`GasPpm` IS NULL OR `GasPpm` BETWEEN 0 AND 1000000");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings",
                sql: "`TemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `BatteryPercent` IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Temperature",
                table: "Readings",
                sql: "`TemperatureC` IS NULL OR `TemperatureC` BETWEEN -50 AND 150");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_ClientMessageId",
                table: "Messages",
                sql: "CHAR_LENGTH(`ClientMessageId`) >= 1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Review",
                table: "Messages",
                sql: "(`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Devices_KeyHash",
                table: "Devices",
                sql: "CHAR_LENGTH(`KeyHash`) = 64");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Devices_Name",
                table: "Devices",
                sql: "CHAR_LENGTH(TRIM(`Name`)) >= 2");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Devices_Zone",
                table: "Devices",
                sql: "CHAR_LENGTH(TRIM(`Zone`)) >= 2");

            foreach (var (_, sql) in Policies)
                migrationBuilder.Sql(sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var (name, _) in Policies)
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS `{name}`");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Email",
                table: "Users");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Name",
                table: "Users");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Battery",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Gas",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Temperature",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_ClientMessageId",
                table: "Messages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Review",
                table: "Messages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Devices_KeyHash",
                table: "Devices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Devices_Name",
                table: "Devices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Devices_Zone",
                table: "Devices");
        }
    }
}
