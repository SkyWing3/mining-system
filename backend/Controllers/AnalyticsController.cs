using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MySql.Data.MySqlClient;

namespace MiningSystem.Controllers;

// EF1002/EF1003: the only interpolated SQL fragments are whitelisted column names and fixed filter clauses; values are parameters.
#pragma warning disable EF1002, EF1003

// Aggregated history for the analysis page. Grouping runs in MySQL; only buckets travel to the client.
[ApiController, Route("api/analytics"), Authorize(Roles = "Admin,Supervisor")]
public sealed class AnalyticsController(MiningDb db) : ControllerBase
{
    public static readonly TimeSpan MaxRange = TimeSpan.FromDays(90);
    public static readonly TimeSpan MaxHourlyRange = TimeSpan.FromDays(14);
    public static readonly TimeSpan AutoHourlyRange = TimeSpan.FromDays(3);
    // Bolivia keeps UTC−4 all year (no daylight saving); days are counted in the mine's local time.
    private static readonly TimeSpan LocalOffset = TimeSpan.FromHours(-4);

    private static readonly Dictionary<string, (string Column, string Unit)> Metrics = new()
    {
        ["temperature"] = ("TemperatureC", "°C"),
        ["gas"] = ("GasPpm", "ppm"),
        ["battery"] = ("BatteryPercent", "%"),
    };

    [HttpGet("readings")]
    public async Task<IActionResult> Readings(string? from, string? to, string? miner, string? zone, string? metric, string? bucket)
    {
        if (Validate(from, to, miner, zone, out var range) is { } invalid) return invalid;
        metric = string.IsNullOrWhiteSpace(metric) ? "temperature" : metric.Trim().ToLowerInvariant();
        if (!Metrics.TryGetValue(metric, out var definition)) return Invalid("Métrica no válida. Usa temperature, gas o battery.");
        bucket = string.IsNullOrWhiteSpace(bucket) || bucket.Trim().Equals("auto", StringComparison.OrdinalIgnoreCase)
            ? (range.To - range.From <= AutoHourlyRange ? "hour" : "day")
            : bucket.Trim().ToLowerInvariant();
        if (bucket is not ("hour" or "day")) return Invalid("Intervalo no válido. Usa hour, day o auto.");
        if (bucket == "hour" && range.To - range.From > MaxHourlyRange) return Invalid("Para intervalos por hora, el rango no puede superar 14 días. Usa intervalos por día.");

        var size = bucket == "hour" ? TimeSpan.FromHours(1) : TimeSpan.FromDays(1);
        var origin = Align(range.From, bucket);
        // The metric column comes from a fixed whitelist; every user value is a parameter.
        var column = $"`{definition.Column}`";
        var filters = Filters(miner, zone, out var parameters);
        var where = $"`ReceivedAt` >= @from AND `ReceivedAt` < @to AND {column} IS NOT NULL{filters}";
        object[] Arguments(params MySqlParameter[] extra) =>
            [new MySqlParameter("@from", range.From), new MySqlParameter("@to", range.To), .. parameters.Select(Clone), .. extra];

        var buckets = await db.Database.SqlQueryRaw<BucketRow>(
            $"SELECT TIMESTAMPDIFF(SECOND, @origin, `ReceivedAt`) DIV @size AS `Bucket`, CAST(COUNT(*) AS SIGNED) AS `Count`, AVG({column}) AS `Average`, MAX({column}) AS `Maximum` " +
            $"FROM `Readings` WHERE {where} GROUP BY `Bucket`",
            Arguments(new MySqlParameter("@origin", origin), new MySqlParameter("@size", (long)size.TotalSeconds))).ToListAsync();
        var summary = await db.Database.SqlQueryRaw<SummaryRow>(
            $"SELECT CAST(COUNT(*) AS SIGNED) AS `Count`, AVG({column}) AS `Average`, MAX({column}) AS `Maximum`, MIN({column}) AS `Minimum` FROM `Readings` WHERE {where}",
            Arguments()).ToListAsync();
        // The miner comparison ignores the miner filter so it can act as the selector (cross-filtering).
        var minerFilters = Filters(null, zone, out var minerParameters);
        var miners = await db.Database.SqlQueryRaw<MinerRow>(
            $"SELECT `MinerName` AS `Miner`, CAST(COUNT(*) AS SIGNED) AS `Count`, AVG({column}) AS `Average`, MAX({column}) AS `Maximum` " +
            $"FROM `Readings` WHERE `ReceivedAt` >= @from AND `ReceivedAt` < @to AND {column} IS NOT NULL{minerFilters} GROUP BY `MinerName` ORDER BY `MinerName`",
            [new MySqlParameter("@from", range.From), new MySqlParameter("@to", range.To), .. minerParameters]).ToListAsync();

        var count = (int)Math.Ceiling((range.To - origin) / size);
        var byBucket = buckets.ToDictionary(x => x.Bucket);
        var totals = summary.Single();
        return Ok(new
        {
            from = range.From, to = range.To, metric, unit = definition.Unit, bucket, timeZone = "America/La_Paz",
            summary = new { readings = totals.Count, average = Round(totals.Average), maximum = Round(totals.Maximum), minimum = Round(totals.Minimum) },
            // Every bucket in the range is returned; empty ones carry count 0 and null values (absence, never zero).
            series = Enumerable.Range(0, count).Select(index =>
            {
                byBucket.TryGetValue(index, out var row);
                return new { start = origin + size * index, count = row?.Count ?? 0, average = Round(row?.Average), maximum = Round(row?.Maximum) };
            }),
            miners = miners.Select(x => new { miner = x.Miner, x.Count, average = Round(x.Average), maximum = Round(x.Maximum) })
        });
    }

    [HttpGet("messages")]
    public async Task<IActionResult> Messages(string? from, string? to, string? miner, string? zone)
    {
        if (Validate(from, to, miner, zone, out var range) is { } invalid) return invalid;
        var origin = Align(range.From, "day");
        var filters = Filters(miner, zone, out var parameters);
        var rows = await db.Database.SqlQueryRaw<MessageRow>(
            "SELECT TIMESTAMPDIFF(SECOND, @origin, `ReceivedAt`) DIV 86400 AS `Bucket`, `Code`, CAST(COUNT(*) AS SIGNED) AS `Count`, " +
            "CAST(SUM(`ReviewedAt` IS NULL) AS SIGNED) AS `Pending` " +
            $"FROM `Messages` WHERE `ReceivedAt` >= @from AND `ReceivedAt` < @to{filters} GROUP BY `Bucket`, `Code`",
            [new MySqlParameter("@from", range.From), new MySqlParameter("@to", range.To), new MySqlParameter("@origin", origin), .. parameters]).ToListAsync();
        var severity = rows.Select(x => (x.Bucket, x.Count, x.Pending, Severity: MessageCatalog.Find(x.Code)?.Severity ?? "info")).ToList();
        long Total(string level, long? day = null) => severity.Where(x => x.Severity == level && (day is null || x.Bucket == day)).Sum(x => x.Count);
        var count = (int)Math.Ceiling((range.To - origin) / TimeSpan.FromDays(1));
        return Ok(new
        {
            from = range.From, to = range.To, timeZone = "America/La_Paz",
            summary = new
            {
                total = severity.Sum(x => x.Count), critical = Total("critical"), warning = Total("warning"), info = Total("info"),
                pendingCritical = severity.Where(x => x.Severity == "critical").Sum(x => x.Pending)
            },
            days = Enumerable.Range(0, count).Select(index => new
            {
                day = (origin + TimeSpan.FromDays(index) + LocalOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                start = origin + TimeSpan.FromDays(index),
                critical = Total("critical", index), warning = Total("warning", index), info = Total("info", index)
            })
        });
    }

    [HttpGet("options")]
    public async Task<IActionResult> Options()
    {
        // Historical names and zones come from the rows, so reassigned or deactivated wearers stay selectable.
        var miners = await db.Readings.AsNoTracking().Select(x => x.MinerName).Distinct().ToListAsync();
        miners.AddRange(await db.Messages.AsNoTracking().Select(x => x.MinerName).Distinct().ToListAsync());
        var zones = await db.Readings.AsNoTracking().Select(x => x.Zone).Distinct().ToListAsync();
        zones.AddRange(await db.Messages.AsNoTracking().Select(x => x.Zone).Distinct().ToListAsync());
        static string[] Clean(IEnumerable<string> values) => values.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().Order(StringComparer.InvariantCultureIgnoreCase).ToArray();
        return Ok(new { miners = Clean(miners), zones = Clean(zones), maxRangeDays = MaxRange.TotalDays, maxHourlyRangeDays = MaxHourlyRange.TotalDays });
    }

    private BadRequestObjectResult Invalid(string message) => BadRequest(new { message });

    private BadRequestObjectResult? Validate(string? from, string? to, string? miner, string? zone, out (DateTime From, DateTime To) range)
    {
        range = default;
        var end = DateTime.UtcNow;
        var start = end - TimeSpan.FromDays(7);
        if (!string.IsNullOrWhiteSpace(to) && !TryParse(to, out end)) return Invalid("La fecha final no es válida. Usa el formato ISO 8601, por ejemplo 2026-10-15T00:00:00Z.");
        if (string.IsNullOrWhiteSpace(from)) start = end - TimeSpan.FromDays(7);
        else if (!TryParse(from, out start)) return Invalid("La fecha inicial no es válida. Usa el formato ISO 8601, por ejemplo 2026-10-01T00:00:00Z.");
        if (start >= end) return Invalid("La fecha inicial debe ser anterior a la fecha final.");
        if (end - start > MaxRange) return Invalid("El rango de fechas no puede superar 90 días.");
        if (miner?.Length > 100 || zone?.Length > 100) return Invalid("El filtro de minero o zona supera los 100 caracteres.");
        range = (start, end);
        return null;
    }

    private static bool TryParse(string value, out DateTime result)
    {
        var parsed = DateTimeOffset.TryParse(value.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var moment);
        result = parsed ? moment.UtcDateTime : default;
        // Keep the same precision as MySQL datetime(6) comparisons.
        return parsed && result.Year is >= 2000 and <= 9998;
    }

    private static DateTime Align(DateTime utc, string bucket)
    {
        if (bucket == "hour") return new DateTime(utc.Year, utc.Month, utc.Day, utc.Hour, 0, 0, DateTimeKind.Utc);
        var local = utc + LocalOffset;
        return DateTime.SpecifyKind(local.Date - LocalOffset, DateTimeKind.Utc);
    }

    private static string Filters(string? miner, string? zone, out List<MySqlParameter> parameters)
    {
        parameters = [];
        var sql = "";
        if (!string.IsNullOrWhiteSpace(miner)) { sql += " AND `MinerName` = @miner"; parameters.Add(new MySqlParameter("@miner", miner.Trim())); }
        if (!string.IsNullOrWhiteSpace(zone)) { sql += " AND `Zone` = @zone"; parameters.Add(new MySqlParameter("@zone", zone.Trim())); }
        return sql;
    }

    private static MySqlParameter Clone(MySqlParameter parameter) => new(parameter.ParameterName, parameter.Value);
    private static double? Round(double? value) => value is null ? null : Math.Round(value.Value, 2);

    private sealed record BucketRow(long Bucket, long Count, double? Average, double? Maximum);
    private sealed record SummaryRow(long Count, double? Average, double? Maximum, double? Minimum);
    private sealed record MinerRow(string Miner, long Count, double? Average, double? Maximum);
    private sealed record MessageRow(long Bucket, string Code, long Count, long Pending);
}
