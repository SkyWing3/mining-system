using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using MiningSystem.Domain;

namespace MiningSystem.Data;

public sealed class MiningDb(DbContextOptions<MiningDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<MiningDevice> Devices => Set<MiningDevice>();
    public DbSet<MiningMessage> Messages => Set<MiningMessage>();
    public DbSet<Reading> Readings => Set<Reading>();
    public DbSet<AuditEvent> Events => Set<AuditEvent>();
    public DbSet<VoiceMessage> VoiceMessages => Set<VoiceMessage>();
    public DbSet<DeviceNotice> Notices => Set<DeviceNotice>();

    public void Audit(string actor, string description, DateTime createdAt) =>
        Events.Add(new AuditEvent { Actor = actor, Description = description, CreatedAt = createdAt });

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.UseCollation("utf8mb4_bin");
        model.ApplyConfigurationsFromAssembly(typeof(MiningDb).Assembly);

        // MySQL DATETIME does not store the time zone; all application dates are UTC.
        var utc = new ValueConverter<DateTime, DateTime>(value => value.ToUniversalTime(), value => DateTime.SpecifyKind(value, DateTimeKind.Utc));
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?))
                    property.SetValueConverter(utc);
    }
}
