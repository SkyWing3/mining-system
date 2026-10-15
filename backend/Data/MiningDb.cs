using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using MiningSystem.Models;

namespace MiningSystem.Data;

public sealed class MiningDb(DbContextOptions<MiningDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<MiningDevice> Devices => Set<MiningDevice>();
    public DbSet<MiningMessage> Messages => Set<MiningMessage>();
    public DbSet<Telemetry> Readings => Set<Telemetry>();
    public DbSet<AuditEvent> Events => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.UseCollation("utf8mb4_bin");
        model.Entity<User>().Property(x => x.Id).HasMaxLength(32);
        model.Entity<User>().Property(x => x.Name).HasMaxLength(100);
        model.Entity<User>().Property(x => x.Email).HasMaxLength(180);
        model.Entity<User>().Property(x => x.Role).HasMaxLength(16);
        model.Entity<User>().Property(x => x.PasswordHash).HasMaxLength(512);
        model.Entity<User>().Property(x => x.SessionVersion).HasMaxLength(32);
        model.Entity<MiningDevice>().Property(x => x.Id).HasMaxLength(32);
        model.Entity<MiningDevice>().Property(x => x.UserId).HasMaxLength(32);
        model.Entity<MiningDevice>().Property(x => x.Name).HasMaxLength(60);
        model.Entity<MiningDevice>().Property(x => x.Zone).HasMaxLength(100);
        model.Entity<MiningDevice>().Property(x => x.KeyHash).HasMaxLength(64);
        model.Entity<MiningMessage>().Property(x => x.DeviceId).HasMaxLength(32);
        model.Entity<MiningMessage>().Property(x => x.ClientMessageId).HasMaxLength(80);
        model.Entity<MiningMessage>().Property(x => x.Code).HasMaxLength(16);
        model.Entity<MiningMessage>().Property(x => x.MinerName).HasMaxLength(100);
        model.Entity<MiningMessage>().Property(x => x.DeviceName).HasMaxLength(60);
        model.Entity<MiningMessage>().Property(x => x.Zone).HasMaxLength(100);
        model.Entity<MiningMessage>().Property(x => x.ReviewedBy).HasMaxLength(100);
        model.Entity<Telemetry>().Property(x => x.DeviceId).HasMaxLength(32);
        model.Entity<AuditEvent>().Property(x => x.Actor).HasMaxLength(100);
        model.Entity<AuditEvent>().Property(x => x.Description).HasMaxLength(500);
        model.Entity<User>().HasIndex(x => x.Email).IsUnique();
        model.Entity<MiningDevice>().HasIndex(x => x.Name).IsUnique();
        model.Entity<MiningDevice>().HasIndex(x => x.KeyHash).IsUnique();
        model.Entity<MiningDevice>().HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<MiningMessage>().HasIndex(x => new { x.DeviceId, x.ClientMessageId }).IsUnique();
        model.Entity<MiningMessage>().HasIndex(x => x.ReceivedAt);
        model.Entity<Telemetry>().HasIndex(x => new { x.DeviceId, x.ReceivedAt });
        // MySQL DATETIME does not store the time zone; all application dates are UTC.
        var utc = new ValueConverter<DateTime, DateTime>(value => value.ToUniversalTime(), value => DateTime.SpecifyKind(value, DateTimeKind.Utc));
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?)) property.SetValueConverter(utc);
    }
}
