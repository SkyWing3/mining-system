using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

// What a stored reading records besides its measurements; any change is always stored.
public readonly record struct ReadingContext(string Level, string MinerName, string DeviceName, string Zone)
{
    public static ReadingContext Of(Reading reading) => new(reading.Level, reading.MinerName, reading.DeviceName, reading.Zone);
}

// Decides which live readings are stored: one per interval and device, plus every change of
// level, wearer or zone, so the history keeps every transition and reassignment.
public sealed class TelemetryPersistencePolicy
{
    private sealed record Entry(DateTime At, ReadingContext Context);

    private readonly ConcurrentDictionary<string, Entry> entries = new();

    public bool ShouldPersist(string deviceId, ReadingContext context, DateTime now, TimeSpan interval)
    {
        if (interval > TimeSpan.Zero && entries.TryGetValue(deviceId, out var last) && last.Context == context && now - last.At < interval)
            return false;
        entries[deviceId] = new Entry(now, context);
        return true;
    }

    public void Forget(string deviceId) => entries.TryRemove(deviceId, out _);
}

// Latest reading of each device, including live readings that were not stored.
public sealed class LatestReadingCache
{
    private readonly ConcurrentDictionary<string, ReadingDto?> readings = new();

    public bool TryGet(string deviceId, out ReadingDto? reading) => readings.TryGetValue(deviceId, out reading);

    public void Set(string deviceId, ReadingDto reading) => readings[deviceId] = reading;

    // A database snapshot never overwrites a newer live reading.
    public ReadingDto? AddIfMissing(string deviceId, ReadingDto? reading) => readings.GetOrAdd(deviceId, reading);
}

public static class TelemetryLimits
{
    public static void Validate(DeviceFrame frame)
    {
        if (frame.TemperatureC is null && frame.ObjectTemperatureC is null && frame.GasPpm is null && frame.GasVoltage is null && frame.BatteryPercent is null)
            throw new DeviceProtocolException("La lectura no contiene mediciones.");
        // Transport validation limits, not safety thresholds.
        Check(frame.TemperatureC, -50, 150, "temperatura");
        Check(frame.ObjectTemperatureC, -70, 380, "temperatura de objeto");
        Check(frame.GasPpm, 0, 1_000_000, "gas");
        Check(frame.GasVoltage, 0, 5.5, "voltaje de gas");
        Check(frame.BatteryPercent, 0, 100, "batería");
        if (frame.Level is not null && !AlertLevels.IsValid(frame.Level))
            throw new DeviceProtocolException("Nivel de alerta inválido.");
    }

    private static void Check(double? value, double min, double max, string field)
    {
        if (value is not null && (!double.IsFinite(value.Value) || value < min || value > max))
            throw new DeviceProtocolException($"Valor de {field} inválido.");
    }
}

public sealed class TelemetryService(
    MiningDb db,
    LatestReadingCache cache,
    TelemetryPersistencePolicy policy,
    IHubContext<MiningHub, IMiningClient> hub,
    IOptions<MiningOptions> options)
{
    public const int MaxHistory = 1000;

    public async Task<ReadingDto> RecordAsync(MiningDevice device, DeviceFrame frame, DateTime now, CancellationToken cancellationToken)
    {
        TelemetryLimits.Validate(frame);
        var reading = new Reading
        {
            DeviceId = device.Id,
            MinerName = device.User?.Name ?? "",
            DeviceName = device.Name,
            Zone = device.Zone,
            TemperatureC = frame.TemperatureC,
            ObjectTemperatureC = frame.ObjectTemperatureC,
            GasPpm = frame.GasPpm,
            GasVoltage = frame.GasVoltage,
            BatteryPercent = frame.BatteryPercent,
            Level = frame.Level ?? AlertLevels.Normal,
            Simulated = frame.Simulated ?? false,
            ReceivedAt = now,
        };
        var interval = TimeSpan.FromSeconds(options.Value.Telemetry.PersistIntervalSeconds);
        var persist = policy.ShouldPersist(device.Id, ReadingContext.Of(reading), now, interval);
        if (persist) db.Readings.Add(reading);
        device.LastSeenAt = now;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            if (persist) policy.Forget(device.Id);
            throw;
        }

        var live = ReadingDto.From(reading, persist);
        cache.Set(device.Id, live);
        await hub.Clients.All.TelemetryReceived(new TelemetryEventDto(device.Id, live));
        return live;
    }

    public async Task<IReadOnlyDictionary<string, ReadingDto?>> LatestAsync(IEnumerable<string> deviceIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, ReadingDto?>();
        foreach (var deviceId in deviceIds.Distinct())
        {
            if (cache.TryGet(deviceId, out var cached))
            {
                result[deviceId] = cached;
                continue;
            }
            // Uses the (DeviceId, ReceivedAt) index backwards: one row per device.
            var stored = await db.Readings.AsNoTracking()
                .Where(x => x.DeviceId == deviceId)
                .OrderByDescending(x => x.ReceivedAt).ThenByDescending(x => x.Id)
                .FirstOrDefaultAsync(cancellationToken);
            result[deviceId] = cache.AddIfMissing(deviceId, stored is null ? null : ReadingDto.From(stored));
        }
        return result;
    }

    public async Task<IReadOnlyList<ReadingDto>> HistoryAsync(string deviceId, TelemetryQuery query, CancellationToken cancellationToken)
    {
        if (!await db.Devices.AnyAsync(x => x.Id == deviceId, cancellationToken)) throw DomainException.NotFound("Manilla no encontrada.");
        var readings = db.Readings.AsNoTracking().Where(x => x.DeviceId == deviceId);
        if (query.Since is { } since)
        {
            var sinceUtc = since.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(since, DateTimeKind.Utc) : since.ToUniversalTime();
            readings = readings.Where(x => x.ReceivedAt >= sinceUtc);
        }
        var rows = await readings
            .OrderByDescending(x => x.ReceivedAt).ThenByDescending(x => x.Id)
            .Take(Math.Clamp(query.Limit, 1, MaxHistory))
            .ToListAsync(cancellationToken);
        return rows.Select(x => ReadingDto.From(x)).ToList();
    }
}
