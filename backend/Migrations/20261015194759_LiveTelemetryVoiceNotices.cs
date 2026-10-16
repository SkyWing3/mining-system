using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class LiveTelemetryVoiceNotices : Migration
    {
        private const string MessagesReviewOnly = "TR_Messages_ReviewOnly";

        // Same append-only policies as AddDatabaseSecurityPolicies, extended to the new tables.
        private static readonly (string Name, string Sql)[] Policies =
        [
            ("TR_VoiceMessages_NoDelete", "CREATE TRIGGER `TR_VoiceMessages_NoDelete` BEFORE DELETE ON `VoiceMessages` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los mensajes de voz no se eliminan.'"),
            ("TR_VoiceMessages_ReviewOnly", @"CREATE TRIGGER `TR_VoiceMessages_ReviewOnly` BEFORE UPDATE ON `VoiceMessages` FOR EACH ROW
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
END"),
            ("TR_Notices_NoDelete", "CREATE TRIGGER `TR_Notices_NoDelete` BEFORE DELETE ON `Notices` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los avisos no se eliminan.'"),
            ("TR_Notices_StatusOnly", @"CREATE TRIGGER `TR_Notices_StatusOnly` BEFORE UPDATE ON `Notices` FOR EACH ROW
BEGIN
    IF NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`) OR NOT (NEW.`Code` <=> OLD.`Code`)
        OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`) OR NOT (NEW.`MinerName` <=> OLD.`MinerName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`CreatedBy` <=> OLD.`CreatedBy`)
        OR NOT (NEW.`CreatedAt` <=> OLD.`CreatedAt`) OR NOT (NEW.`ExpiresAt` <=> OLD.`ExpiresAt`)
        OR (OLD.`DeliveredAt` IS NOT NULL AND NOT (NEW.`DeliveredAt` <=> OLD.`DeliveredAt`))
        OR (OLD.`ReadAt` IS NOT NULL AND NOT (NEW.`ReadAt` <=> OLD.`ReadAt`)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un aviso solo admite registrar su entrega y su lectura, una sola vez.';
    END IF;
END"),
        ];

        // TR_Messages_ReviewOnly also protects the new Detail column; the previous version is restored on Down.
        private const string MessagesReviewOnlyWithDetail = @"CREATE TRIGGER `TR_Messages_ReviewOnly` BEFORE UPDATE ON `Messages` FOR EACH ROW
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
END";

        private const string MessagesReviewOnlyPrevious = @"CREATE TRIGGER `TR_Messages_ReviewOnly` BEFORE UPDATE ON `Messages` FOR EACH ROW
BEGIN
    IF OLD.`ReviewedAt` IS NOT NULL OR NEW.`ReviewedAt` IS NULL
        OR NOT (NEW.`Id` <=> OLD.`Id`) OR NOT (NEW.`DeviceId` <=> OLD.`DeviceId`)
        OR NOT (NEW.`ClientMessageId` <=> OLD.`ClientMessageId`) OR NOT (NEW.`Code` <=> OLD.`Code`)
        OR NOT (NEW.`MinerName` <=> OLD.`MinerName`) OR NOT (NEW.`DeviceName` <=> OLD.`DeviceName`)
        OR NOT (NEW.`Zone` <=> OLD.`Zone`) OR NOT (NEW.`SentAt` <=> OLD.`SentAt`)
        OR NOT (NEW.`ReceivedAt` <=> OLD.`ReceivedAt`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un mensaje solo admite registrar su revisión, y una sola vez.';
    END IF;
END";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings");

            migrationBuilder.AddColumn<double>(
                name: "GasVoltage",
                table: "Readings",
                type: "double",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Level",
                table: "Readings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                // Readings stored before alert levels existed were not classified.
                defaultValue: "normal");

            migrationBuilder.AddColumn<double>(
                name: "ObjectTemperatureC",
                table: "Readings",
                type: "double",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Simulated",
                table: "Readings",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Detail",
                table: "Messages",
                type: "varchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Notices",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    DeviceId = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    Code = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    DeviceName = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: false),
                    MinerName = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: true),
                    Zone = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    CreatedBy = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    DeliveredAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ReadAt = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notices", x => x.Id);
                    table.CheckConstraint("CK_Notices_Code", "CHAR_LENGTH(`Code`) >= 1");
                    table.CheckConstraint("CK_Notices_Expiry", "`ExpiresAt` > `CreatedAt`");
                    table.CheckConstraint("CK_Notices_ReadAfterDelivery", "`ReadAt` IS NULL OR `DeliveredAt` IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_Notices_Devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "Devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("Relational:Collation", "utf8mb4_bin");

            migrationBuilder.CreateTable(
                name: "VoiceMessages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySQL:ValueGenerationStrategy", MySQLValueGenerationStrategy.IdentityColumn),
                    DeviceId = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    ClientMessageId = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    MinerName = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    DeviceName = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: false),
                    Zone = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    DurationMs = table.Column<int>(type: "int", nullable: false),
                    SampleRate = table.Column<int>(type: "int", nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    StoragePath = table.Column<string>(type: "varchar(260)", maxLength: 260, nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ReviewedBy = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceMessages", x => x.Id);
                    table.CheckConstraint("CK_VoiceMessages_ClientMessageId", "CHAR_LENGTH(`ClientMessageId`) >= 1");
                    table.CheckConstraint("CK_VoiceMessages_Duration", "`DurationMs` > 0");
                    table.CheckConstraint("CK_VoiceMessages_Review", "(`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)");
                    table.CheckConstraint("CK_VoiceMessages_Size", "`SizeBytes` > 0");
                    table.ForeignKey(
                        name: "FK_VoiceMessages_Devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "Devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("Relational:Collation", "utf8mb4_bin");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_GasVoltage",
                table: "Readings",
                sql: "`GasVoltage` IS NULL OR `GasVoltage` BETWEEN 0 AND 5.5");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Level",
                table: "Readings",
                sql: "`Level` IN ('normal', 'caution', 'danger')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings",
                sql: "`TemperatureC` IS NOT NULL OR `ObjectTemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `GasVoltage` IS NOT NULL OR `BatteryPercent` IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_ObjectTemperature",
                table: "Readings",
                sql: "`ObjectTemperatureC` IS NULL OR `ObjectTemperatureC` BETWEEN -70 AND 380");

            migrationBuilder.CreateIndex(
                name: "IX_Notices_DeviceId_ReadAt",
                table: "Notices",
                columns: new[] { "DeviceId", "ReadAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Notices_ExpiresAt",
                table: "Notices",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_VoiceMessages_DeviceId_ClientMessageId",
                table: "VoiceMessages",
                columns: new[] { "DeviceId", "ClientMessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VoiceMessages_ReceivedAt",
                table: "VoiceMessages",
                column: "ReceivedAt");
        
            migrationBuilder.Sql($"DROP TRIGGER IF EXISTS `{MessagesReviewOnly}`");
            migrationBuilder.Sql(MessagesReviewOnlyWithDetail);
            foreach (var (_, sql) in Policies)
                migrationBuilder.Sql(sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var (name, _) in Policies)
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS `{name}`");
            migrationBuilder.Sql($"DROP TRIGGER IF EXISTS `{MessagesReviewOnly}`");
            migrationBuilder.Sql(MessagesReviewOnlyPrevious);

            migrationBuilder.DropTable(
                name: "Notices");

            migrationBuilder.DropTable(
                name: "VoiceMessages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_GasVoltage",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Level",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Readings_ObjectTemperature",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "GasVoltage",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "Level",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "ObjectTemperatureC",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "Simulated",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "Detail",
                table: "Messages");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Readings_Measurement",
                table: "Readings",
                sql: "`TemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `BatteryPercent` IS NOT NULL");
        }
    }
}
