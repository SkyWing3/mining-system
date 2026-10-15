using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.UnitTests;

public sealed class DomainTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void PersistencePolicyKeepsOnePerIntervalAndEveryLevelChange()
    {
        var policy = new TelemetryPersistencePolicy();
        var interval = TimeSpan.FromSeconds(10);
        Assert.True(policy.ShouldPersist("a", AlertLevels.Normal, Now, interval));
        Assert.False(policy.ShouldPersist("a", AlertLevels.Normal, Now.AddSeconds(2), interval));
        Assert.True(policy.ShouldPersist("b", AlertLevels.Normal, Now.AddSeconds(2), interval));
        Assert.True(policy.ShouldPersist("a", AlertLevels.Danger, Now.AddSeconds(3), interval));
        Assert.False(policy.ShouldPersist("a", AlertLevels.Danger, Now.AddSeconds(12), interval));
        Assert.True(policy.ShouldPersist("a", AlertLevels.Danger, Now.AddSeconds(13), interval));
        policy.Forget("a");
        Assert.True(policy.ShouldPersist("a", AlertLevels.Danger, Now.AddSeconds(14), interval));
        Assert.True(policy.ShouldPersist("a", AlertLevels.Danger, Now.AddSeconds(14), TimeSpan.Zero));
    }

    [Fact]
    public void TelemetryLimitsAreTransportRules()
    {
        TelemetryLimits.Validate(new DeviceFrame("telemetry", TemperatureC: 24, Level: AlertLevels.Caution));
        TelemetryLimits.Validate(new DeviceFrame("telemetry", ObjectTemperatureC: 380, GasVoltage: 0));
        Assert.Throws<DeviceProtocolException>(() => TelemetryLimits.Validate(new DeviceFrame("telemetry")));
        Assert.Throws<DeviceProtocolException>(() => TelemetryLimits.Validate(new DeviceFrame("telemetry", BatteryPercent: 101)));
        Assert.Throws<DeviceProtocolException>(() => TelemetryLimits.Validate(new DeviceFrame("telemetry", GasPpm: double.NaN)));
        Assert.Throws<DeviceProtocolException>(() => TelemetryLimits.Validate(new DeviceFrame("telemetry", TemperatureC: 20, Level: "panic")));
    }

    [Fact]
    public void BoliviaDayStartsAtFourUtc()
    {
        Assert.Equal(new DateTime(2026, 10, 15, 4, 0, 0, DateTimeKind.Utc), Clock.StartOfLocalDayUtc(Now));
        Assert.Equal(new DateTime(2026, 10, 14, 4, 0, 0, DateTimeKind.Utc), Clock.StartOfLocalDayUtc(new DateTime(2026, 10, 15, 3, 59, 0, DateTimeKind.Utc)));
        Assert.Equal(0, Clock.Truncate(new DateTime(638_000_000_000_000_007, DateTimeKind.Utc)).Ticks % 10);
    }

    [Fact]
    public void NoticeStatusFollowsDeliveryReadingAndExpiry()
    {
        var notice = new DeviceNotice { CreatedAt = Now, ExpiresAt = Now.AddMinutes(30) };
        Assert.Equal(NoticeStatuses.Pending, notice.StatusAt(Now));
        Assert.Equal(NoticeStatuses.Expired, notice.StatusAt(Now.AddMinutes(30)));
        notice.DeliveredAt = Now.AddMinutes(1);
        Assert.Equal(NoticeStatuses.Delivered, notice.StatusAt(Now.AddHours(1)));
        notice.ReadAt = Now.AddMinutes(2);
        Assert.Equal(NoticeStatuses.Read, notice.StatusAt(Now.AddHours(1)));
    }

    [Fact]
    public void CatalogsFitTheDatabaseAndTheOled()
    {
        Assert.All(MessageCatalog.All, kind => Assert.InRange(kind.Code.Length, 1, 16));
        Assert.All(NoticeCatalog.All, kind => Assert.InRange(kind.Code.Length, 1, 24));
        Assert.All(NoticeCatalog.All, kind => Assert.InRange(kind.Text.Length, 1, 20));
        Assert.Equal(MessageCatalog.All.Length, MessageCatalog.All.Select(kind => kind.Code).Distinct().Count());
        Assert.Equal(["CO_ALARM", "HEAT_ALARM"], MessageCatalog.All.Where(kind => kind.Automatic).Select(kind => kind.Code));
        Assert.All(MessageCatalog.All.Concat<object>(NoticeCatalog.All), kind => Assert.Contains(
            kind is MessageKind message ? message.Severity : ((NoticeKind)kind).Severity, Severities.All));
    }

    [Fact]
    public void DeviceKeysAreRandomHexAndOnlyTheHashIsComparable()
    {
        var key = DeviceKeys.Generate();
        Assert.True(DeviceKeys.HasValidFormat(key));
        Assert.NotEqual(key, DeviceKeys.Generate());
        Assert.Equal(64, DeviceKeys.Hash(key).Length);
        Assert.False(DeviceKeys.HasValidFormat("not-a-key"));
        Assert.False(DeviceKeys.HasValidFormat(null));
    }
}
