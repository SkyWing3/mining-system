using System;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.EntityFrameworkCore.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class LiveTelemetryVoiceNotices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
                    table.ForeignKey(
                        name: "FK_VoiceMessages_Devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "Devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("Relational:Collation", "utf8mb4_bin");

            migrationBuilder.CreateIndex(
                name: "IX_Readings_ReceivedAt",
                table: "Readings",
                column: "ReceivedAt");

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Notices");

            migrationBuilder.DropTable(
                name: "VoiceMessages");

            migrationBuilder.DropIndex(
                name: "IX_Readings_ReceivedAt",
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
        }
    }
}
