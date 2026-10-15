namespace MiningSystem.Models;

public sealed class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "Miner";
    public bool Active { get; set; } = true;
    public string PasswordHash { get; set; } = "";
    public string SessionVersion { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class MiningDevice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string Zone { get; set; } = "";
    public string? UserId { get; set; }
    public User? User { get; set; }
    public string KeyHash { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTime? LastSeenAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class MiningMessage
{
    public long Id { get; set; }
    public string DeviceId { get; set; } = "";
    public MiningDevice Device { get; set; } = null!;
    public string ClientMessageId { get; set; } = "";
    public string Code { get; set; } = "";
    // Preserve who wore the device and where it was, even after reassignment.
    public string MinerName { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string Zone { get; set; } = "";
    public DateTime SentAt { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
}

public sealed class Telemetry
{
    public long Id { get; set; }
    public string DeviceId { get; set; } = "";
    public MiningDevice Device { get; set; } = null!;
    // Preserve who wore the device and where it was, even after reassignment.
    public string MinerName { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string Zone { get; set; } = "";
    public double? TemperatureC { get; set; }
    // SEN0564 (CO) values must be calibrated before reporting actual ppm.
    public double? GasPpm { get; set; }
    public double? BatteryPercent { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AuditEvent
{
    public long Id { get; set; }
    public string Actor { get; set; } = "Sistema";
    public string Description { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed record MessageKind(string Code, string Text, string Severity);

public static class MessageCatalog
{
    public static readonly MessageKind[] All =
    [
        new("HELP", "Ayuda", "critical"),
        new("OK", "Todo bien", "info"),
        new("COLLAPSE", "Hay derrumbe", "critical"),
        new("GAS", "Presencia de gas", "critical"),
        new("INJURY", "Compañero herido", "critical"),
        new("EVACUATE", "Necesito evacuar", "critical"),
        new("SUPPLIES", "Necesito suministros", "warning"),
        new("EXIT", "Saliendo de la mina", "info")
    ];
    public static MessageKind? Find(string code) => All.FirstOrDefault(x => x.Code == code);
}
