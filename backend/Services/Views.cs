using MiningSystem.Models;

namespace MiningSystem.Services;

public static class Views
{
    public static object User(User user) => new { user.Id, user.Name, user.Email, user.Role, user.Active, user.CreatedAt };
    public static object Device(MiningDevice device, Telemetry? reading = null) => new
    {
        device.Id, device.Name, device.Zone, device.UserId, minerName = device.User?.Name,
        device.Active, device.LastSeenAt, device.CreatedAt,
        online = device.Active && device.LastSeenAt > DateTime.UtcNow.AddSeconds(-90),
        reading = reading is null ? null : new { reading.TemperatureC, reading.GasPpm, reading.BatteryPercent, reading.ReceivedAt }
    };
    public static object Message(MiningMessage message) => new
    {
        message.Id, message.DeviceId, message.Code,
        text = MessageCatalog.Find(message.Code)!.Text,
        severity = MessageCatalog.Find(message.Code)!.Severity,
        message.MinerName, message.DeviceName, message.Zone, message.SentAt, message.ReceivedAt,
        message.ReviewedAt, message.ReviewedBy
    };
}
