using MiningSystem.Domain;

namespace MiningSystem.DTOs;

// Public shapes returned by the API and SignalR. Hashes and storage paths are never exposed.
public sealed record UserDto(string Id, string Name, string Email, string Role, bool Active, DateTime CreatedAt)
{
    public static UserDto From(User user) => new(user.Id, user.Name, user.Email, user.Role, user.Active, user.CreatedAt);
}

public sealed record ReadingDto(
    long? Id,
    // Wearer and zone recorded when the reading was received.
    string MinerName,
    string DeviceName,
    string Zone,
    double? TemperatureC,
    double? ObjectTemperatureC,
    double? GasPpm,
    double? GasVoltage,
    double? BatteryPercent,
    string Level,
    bool Simulated,
    DateTime ReceivedAt)
{
    public static ReadingDto From(Reading reading, bool persisted = true) => new(
        persisted ? reading.Id : null, reading.MinerName, reading.DeviceName, reading.Zone, reading.TemperatureC, reading.ObjectTemperatureC, reading.GasPpm,
        reading.GasVoltage, reading.BatteryPercent, reading.Level, reading.Simulated, reading.ReceivedAt);
}

public sealed record DeviceDto(
    string Id,
    string Name,
    string Zone,
    string? UserId,
    string? MinerName,
    bool Active,
    DateTime? LastSeenAt,
    DateTime CreatedAt,
    bool Online,
    ReadingDto? Reading)
{
    public static DeviceDto From(MiningDevice device, bool online, ReadingDto? reading) => new(
        device.Id, device.Name, device.Zone, device.UserId, device.User?.Name, device.Active,
        device.LastSeenAt, device.CreatedAt, online, reading);
}

public sealed record DeviceSavedDto(DeviceDto Device, string? ApiKey);

public sealed record ApiKeyDto(string ApiKey);

public sealed record MessageDto(
    long Id,
    string DeviceId,
    string Code,
    string Text,
    string Severity,
    string? Detail,
    string MinerName,
    string DeviceName,
    string Zone,
    DateTime SentAt,
    DateTime ReceivedAt,
    DateTime? ReviewedAt,
    string? ReviewedBy)
{
    public static MessageDto From(MiningMessage message)
    {
        var kind = MessageCatalog.Get(message.Code);
        return new(message.Id, message.DeviceId, message.Code, kind.Text, kind.Severity, message.Detail,
            message.MinerName, message.DeviceName, message.Zone, message.SentAt, message.ReceivedAt,
            message.ReviewedAt, message.ReviewedBy);
    }
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public sealed record OverviewDto(
    int TotalDevices,
    int OnlineDevices,
    int ActiveMiners,
    int MessagesToday,
    int PendingAlerts,
    int LiveDanger,
    int PendingVoice,
    int PendingNotices,
    DateTime ServerTime,
    IReadOnlyList<MessageDto> RecentMessages,
    IReadOnlyList<MessageKind> Catalog,
    IReadOnlyList<NoticeKind> NoticeCatalog);

public sealed record TelemetryEventDto(string DeviceId, ReadingDto Reading);

public sealed record VoiceMessageDto(
    long Id,
    string DeviceId,
    string MinerName,
    string DeviceName,
    string Zone,
    DateTime RecordedAt,
    DateTime ReceivedAt,
    int DurationMs,
    long SizeBytes,
    DateTime? ReviewedAt,
    string? ReviewedBy)
{
    public static VoiceMessageDto From(VoiceMessage voice) => new(
        voice.Id, voice.DeviceId, voice.MinerName, voice.DeviceName, voice.Zone, voice.RecordedAt,
        voice.ReceivedAt, voice.DurationMs, voice.SizeBytes, voice.ReviewedAt, voice.ReviewedBy);
}

public sealed record NoticeDto(
    long Id,
    string DeviceId,
    string Code,
    string Text,
    string Severity,
    string DeviceName,
    string? MinerName,
    string Zone,
    string CreatedBy,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    DateTime? DeliveredAt,
    DateTime? ReadAt,
    string Status)
{
    public static NoticeDto From(DeviceNotice notice, DateTime now)
    {
        var kind = NoticeCatalog.Get(notice.Code);
        return new(notice.Id, notice.DeviceId, notice.Code, kind.Text, kind.Severity, notice.DeviceName,
            notice.MinerName, notice.Zone, notice.CreatedBy, notice.CreatedAt, notice.ExpiresAt,
            notice.DeliveredAt, notice.ReadAt, notice.StatusAt(now));
    }
}

public sealed record AuditEventDto(long Id, string Actor, string Description, DateTime CreatedAt)
{
    public static AuditEventDto From(AuditEvent audit) => new(audit.Id, audit.Actor, audit.Description, audit.CreatedAt);
}
