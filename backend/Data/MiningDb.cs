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
        model.Entity<User>().HasIndex(x => x.Email).IsUnique();
        model.Entity<MiningDevice>().HasIndex(x => x.Name).IsUnique();
        model.Entity<MiningDevice>().HasIndex(x => x.KeyHash).IsUnique();
        model.Entity<MiningDevice>().HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<MiningMessage>().HasIndex(x => new { x.DeviceId, x.ClientMessageId }).IsUnique();
        model.Entity<MiningMessage>().HasIndex(x => x.ReceivedAt);
        model.Entity<Telemetry>().HasIndex(x => new { x.DeviceId, x.ReceivedAt });
        // SQLite drops DateTime.Kind; restore UTC before serializing API responses.
        var utc = new ValueConverter<DateTime, DateTime>(value => value.ToUniversalTime(), value => DateTime.SpecifyKind(value, DateTimeKind.Utc));
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?)) property.SetValueConverter(utc);
    }
}
