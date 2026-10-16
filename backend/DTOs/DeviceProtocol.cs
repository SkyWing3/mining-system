using System.Text.Json;
using System.Text.Json.Serialization;

namespace MiningSystem.DTOs;

// Device ⇄ central frames on /ws/device. See docs/api.md.
public static class DeviceFrameTypes
{
    public const string Heartbeat = "heartbeat";
    public const string Telemetry = "telemetry";
    public const string Message = "message";
    public const string NoticeAck = "notice-ack";
    public const string Ack = "ack";
    public const string Error = "error";
    public const string Notice = "notice";
}

public static class DeviceErrorCodes
{
    // The frame can never succeed; the device should discard it.
    public const string Invalid = "invalid";
    // The device needs an active miner assigned from the web; keep the frame queued.
    public const string Unassigned = "unassigned";
    // Revoked credential or disabled device; the socket is closed.
    public const string Unauthorized = "unauthorized";
    // Temporary server failure; retry later.
    public const string Unavailable = "unavailable";
}

public static class NoticeAckStages
{
    public const string Delivered = "delivered";
    public const string Read = "read";
}

public sealed record DeviceFrame(
    string? Type,
    string? ClientMessageId = null,
    string? Code = null,
    DateTimeOffset? SentAt = null,
    string? Detail = null,
    double? TemperatureC = null,
    double? ObjectTemperatureC = null,
    double? GasPpm = null,
    double? GasVoltage = null,
    double? BatteryPercent = null,
    string? Level = null,
    bool? Simulated = null,
    long? NoticeId = null,
    string? Stage = null);

public sealed record DeviceIdentity(string Name, string? MinerName, string Zone);

public sealed record AckFrame(
    string? ClientMessageId,
    long? MessageId,
    bool Duplicate,
    DateTime ServerTime,
    DeviceIdentity? Device = null,
    long? NoticeId = null)
{
    public string Type => DeviceFrameTypes.Ack;
}

public sealed record ErrorFrame(string Code, string Message)
{
    public string Type => DeviceFrameTypes.Error;
}

public sealed record NoticeFrame(long NoticeId, string Code, string Text, string Severity, DateTime CreatedAt, DateTime ExpiresAt)
{
    public string Type => DeviceFrameTypes.Notice;
}

public sealed class DeviceProtocolException(string message, string code = DeviceErrorCodes.Invalid) : Exception(message)
{
    public string Code { get; } = code;
    public bool Unauthorized => Code == DeviceErrorCodes.Unauthorized;
}

public static class DeviceJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
