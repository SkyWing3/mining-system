namespace MiningSystem.Domain;

public static class Clock
{
    private static readonly TimeZoneInfo Bolivia = FindBolivia();

    // MySQL datetime(6) keeps microseconds; truncating keeps responses identical before and after a round trip.
    public static DateTime UtcNow(this TimeProvider time) => Truncate(time.GetUtcNow().UtcDateTime);

    public static DateTime Truncate(DateTime value) =>
        new(value.Ticks - value.Ticks % TimeSpan.TicksPerMicrosecond, DateTimeKind.Utc);

    // Start of the current day in Bolivia (America/La_Paz, UTC−4 without daylight saving), expressed in UTC.
    public static DateTime StartOfLocalDayUtc(DateTime utcNow)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), Bolivia);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local.Date, DateTimeKind.Unspecified), Bolivia);
    }

    private static TimeZoneInfo FindBolivia()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("America/La_Paz"); }
        catch (Exception error) when (error is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.CreateCustomTimeZone("America/La_Paz", TimeSpan.FromHours(-4), "Bolivia", "BOT");
        }
    }
}
