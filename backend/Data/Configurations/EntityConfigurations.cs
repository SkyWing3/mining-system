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
    }
}

internal sealed class ReadingConfiguration : IEntityTypeConfiguration<Reading>
{
    public void Configure(EntityTypeBuilder<Reading> entity)
    {
        entity.ToTable("Readings");
        entity.Property(x => x.DeviceId).HasMaxLength(32);
        entity.Property(x => x.Level).HasMaxLength(16);
        entity.HasIndex(x => new { x.DeviceId, x.ReceivedAt });
        // Used by the retention cleanup.
        entity.HasIndex(x => x.ReceivedAt);
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
    }
}
