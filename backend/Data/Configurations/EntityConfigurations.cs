using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MiningSystem.Domain;

namespace MiningSystem.Data.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> entity)
    {
        entity.ToTable("Users");
        entity.Property(x => x.Id).HasMaxLength(32);
        entity.Property(x => x.Name).HasMaxLength(100);
        entity.Property(x => x.Email).HasMaxLength(180);
        entity.Property(x => x.Role).HasMaxLength(16);
        entity.Property(x => x.PasswordHash).HasMaxLength(512);
        entity.Property(x => x.SessionVersion).HasMaxLength(32);
        entity.HasIndex(x => x.Email).IsUnique();
        // The database rejects invalid rows even when they bypass the API.
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_Users_Role", "`Role` IN ('Admin', 'Supervisor', 'Miner')");
            table.HasCheckConstraint("CK_Users_Name", "CHAR_LENGTH(TRIM(`Name`)) >= 2");
            table.HasCheckConstraint("CK_Users_Email", "`Email` LIKE '%_@_%'");
        });
    }
}

internal sealed class DeviceConfiguration : IEntityTypeConfiguration<MiningDevice>
{
    public void Configure(EntityTypeBuilder<MiningDevice> entity)
    {
        entity.ToTable("Devices");
        entity.Property(x => x.Id).HasMaxLength(32);
        entity.Property(x => x.UserId).HasMaxLength(32);
        entity.Property(x => x.Name).HasMaxLength(60);
        entity.Property(x => x.Zone).HasMaxLength(100);
        entity.Property(x => x.KeyHash).HasMaxLength(64);
        entity.HasIndex(x => x.Name).IsUnique();
        entity.HasIndex(x => x.KeyHash).IsUnique();
        entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        entity.Ignore(x => x.HasActiveMiner);
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_Devices_Name", "CHAR_LENGTH(TRIM(`Name`)) >= 2");
            table.HasCheckConstraint("CK_Devices_Zone", "CHAR_LENGTH(TRIM(`Zone`)) >= 2");
            table.HasCheckConstraint("CK_Devices_KeyHash", "CHAR_LENGTH(`KeyHash`) = 64");
        });
    }
}

internal sealed class MessageConfiguration : IEntityTypeConfiguration<MiningMessage>
{
    public void Configure(EntityTypeBuilder<MiningMessage> entity)
    {
        entity.ToTable("Messages");
        entity.Property(x => x.DeviceId).HasMaxLength(32);
        entity.Property(x => x.ClientMessageId).HasMaxLength(80);
        entity.Property(x => x.Code).HasMaxLength(16);
        entity.Property(x => x.Detail).HasMaxLength(120);
        entity.Property(x => x.MinerName).HasMaxLength(100);
        entity.Property(x => x.DeviceName).HasMaxLength(60);
        entity.Property(x => x.Zone).HasMaxLength(100);
        entity.Property(x => x.ReviewedBy).HasMaxLength(100);
        entity.HasIndex(x => new { x.DeviceId, x.ClientMessageId }).IsUnique();
        entity.HasIndex(x => x.ReceivedAt);
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_Messages_ClientMessageId", "CHAR_LENGTH(`ClientMessageId`) >= 1");
            table.HasCheckConstraint("CK_Messages_Review", "(`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)");
        });
    }
}

internal sealed class ReadingConfiguration : IEntityTypeConfiguration<Reading>
{
    public void Configure(EntityTypeBuilder<Reading> entity)
    {
        entity.ToTable("Readings");
        entity.Property(x => x.DeviceId).HasMaxLength(32);
        entity.Property(x => x.MinerName).HasMaxLength(100);
        entity.Property(x => x.DeviceName).HasMaxLength(60);
        entity.Property(x => x.Zone).HasMaxLength(100);
        entity.Property(x => x.Level).HasMaxLength(16);
        entity.HasIndex(x => new { x.DeviceId, x.ReceivedAt });
        entity.HasIndex(x => new { x.MinerName, x.ReceivedAt });
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_Readings_Measurement",
                "`TemperatureC` IS NOT NULL OR `ObjectTemperatureC` IS NOT NULL OR `GasPpm` IS NOT NULL OR `GasVoltage` IS NOT NULL OR `BatteryPercent` IS NOT NULL");
            table.HasCheckConstraint("CK_Readings_Temperature", "`TemperatureC` IS NULL OR `TemperatureC` BETWEEN -50 AND 150");
            table.HasCheckConstraint("CK_Readings_ObjectTemperature", "`ObjectTemperatureC` IS NULL OR `ObjectTemperatureC` BETWEEN -70 AND 380");
            table.HasCheckConstraint("CK_Readings_Gas", "`GasPpm` IS NULL OR `GasPpm` BETWEEN 0 AND 1000000");
            table.HasCheckConstraint("CK_Readings_GasVoltage", "`GasVoltage` IS NULL OR `GasVoltage` BETWEEN 0 AND 5.5");
            table.HasCheckConstraint("CK_Readings_Battery", "`BatteryPercent` IS NULL OR `BatteryPercent` BETWEEN 0 AND 100");
            table.HasCheckConstraint("CK_Readings_Level", "`Level` IN ('normal', 'caution', 'danger')");
        });
    }
}

internal sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> entity)
    {
        entity.ToTable("Events");
        entity.Property(x => x.Actor).HasMaxLength(100);
        entity.Property(x => x.Description).HasMaxLength(500);
    }
}

internal sealed class VoiceMessageConfiguration : IEntityTypeConfiguration<VoiceMessage>
{
    public void Configure(EntityTypeBuilder<VoiceMessage> entity)
    {
        entity.ToTable("VoiceMessages");
        entity.Property(x => x.DeviceId).HasMaxLength(32);
        entity.Property(x => x.ClientMessageId).HasMaxLength(80);
        entity.Property(x => x.MinerName).HasMaxLength(100);
        entity.Property(x => x.DeviceName).HasMaxLength(60);
        entity.Property(x => x.Zone).HasMaxLength(100);
        entity.Property(x => x.StoragePath).HasMaxLength(260);
        entity.Property(x => x.ReviewedBy).HasMaxLength(100);
        entity.HasIndex(x => new { x.DeviceId, x.ClientMessageId }).IsUnique();
        entity.HasIndex(x => x.ReceivedAt);
        entity.HasOne(x => x.Device).WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Restrict);
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_VoiceMessages_ClientMessageId", "CHAR_LENGTH(`ClientMessageId`) >= 1");
            table.HasCheckConstraint("CK_VoiceMessages_Duration", "`DurationMs` > 0");
            table.HasCheckConstraint("CK_VoiceMessages_Size", "`SizeBytes` > 0");
            table.HasCheckConstraint("CK_VoiceMessages_Review", "(`ReviewedAt` IS NULL) = (`ReviewedBy` IS NULL)");
        });
    }
}

internal sealed class DeviceNoticeConfiguration : IEntityTypeConfiguration<DeviceNotice>
{
    public void Configure(EntityTypeBuilder<DeviceNotice> entity)
    {
        entity.ToTable("Notices");
        entity.Property(x => x.DeviceId).HasMaxLength(32);
        entity.Property(x => x.Code).HasMaxLength(24);
        entity.Property(x => x.DeviceName).HasMaxLength(60);
        entity.Property(x => x.MinerName).HasMaxLength(100);
        entity.Property(x => x.Zone).HasMaxLength(100);
        entity.Property(x => x.CreatedBy).HasMaxLength(100);
        entity.HasIndex(x => new { x.DeviceId, x.ReadAt });
        entity.HasIndex(x => x.ExpiresAt);
        entity.HasOne(x => x.Device).WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Restrict);
        entity.ToTable(table =>
        {
            table.HasCheckConstraint("CK_Notices_Code", "CHAR_LENGTH(`Code`) >= 1");
            table.HasCheckConstraint("CK_Notices_Expiry", "`ExpiresAt` > `CreatedAt`");
            // A notice can only be read after it was delivered.
            table.HasCheckConstraint("CK_Notices_ReadAfterDelivery", "`ReadAt` IS NULL OR `DeliveredAt` IS NOT NULL");
        });
    }
}
