using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalyticsIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Readings_ReceivedAt",
                table: "Readings",
                column: "ReceivedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Readings_Zone_ReceivedAt",
                table: "Readings",
                columns: new[] { "Zone", "ReceivedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Readings_ReceivedAt",
                table: "Readings");

            migrationBuilder.DropIndex(
                name: "IX_Readings_Zone_ReceivedAt",
                table: "Readings");
        }
    }
}
