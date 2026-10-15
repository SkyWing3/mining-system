using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddTelemetryTraceability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeviceName",
                table: "Readings",
                type: "varchar(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "MinerName",
                table: "Readings",
                type: "varchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Zone",
                table: "Readings",
                type: "varchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Readings_MinerName_ReceivedAt",
                table: "Readings",
                columns: new[] { "MinerName", "ReceivedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Readings_MinerName_ReceivedAt",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "DeviceName",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "MinerName",
                table: "Readings");

            migrationBuilder.DropColumn(
                name: "Zone",
                table: "Readings");
        }
    }
}
