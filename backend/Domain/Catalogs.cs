namespace MiningSystem.Domain;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Supervisor = "Supervisor";
    public const string Miner = "Miner";
    // Accounts allowed to use the operations panel.
    public const string Operators = Admin + "," + Supervisor;
    public static readonly string[] All = [Admin, Supervisor, Miner];
    public static bool IsValid(string? role) => role is not null && All.Contains(role);
}

public static class Severities
{
    public const string Critical = "critical";
    public const string Warning = "warning";
    public const string Info = "info";
    public static readonly string[] All = [Critical, Warning, Info];
}

public static class AlertLevels
{
    public const string Normal = "normal";
    public const string Caution = "caution";
    public const string Danger = "danger";
    public static readonly string[] All = [Normal, Caution, Danger];
    public static bool IsValid(string? level) => level is not null && All.Contains(level);
}

public static class NoticeStatuses
{
    public const string Pending = "pending";
    public const string Delivered = "delivered";
    public const string Read = "read";
    public const string Expired = "expired";
}

public sealed record MessageKind(string Code, string Text, string Severity, bool Automatic = false);

// Codes shared with device/src/communication/catalog.py.
public static class MessageCatalog
{
    public static readonly MessageKind[] All =
    [
        new("HELP", "Ayuda", Severities.Critical),
        new("OK", "Todo bien", Severities.Info),
        new("COLLAPSE", "Hay derrumbe", Severities.Critical),
        new("GAS", "Presencia de gas", Severities.Critical),
        new("INJURY", "Compañero herido", Severities.Critical),
        new("EVACUATE", "Necesito evacuar", Severities.Critical),
        new("SUPPLIES", "Necesito suministros", Severities.Warning),
        new("EXIT", "Saliendo de la mina", Severities.Info),
        // Sent automatically by the device when a sensor reaches its danger threshold.
        new("CO_ALARM", "Alarma de CO", Severities.Critical, Automatic: true),
        new("HEAT_ALARM", "Alarma de temperatura", Severities.Critical, Automatic: true),
    ];

    public static MessageKind? Find(string? code) => All.FirstOrDefault(kind => kind.Code == code);

    public static MessageKind Get(string code) => Find(code) ?? throw new InvalidOperationException($"Unknown message code {code}.");

    public static string[] CodesWithSeverity(string severity) => All.Where(kind => kind.Severity == severity).Select(kind => kind.Code).ToArray();
}

public sealed record NoticeKind(string Code, string Text, string Severity);

// Notices from the central to a device. Texts fit one OLED line (20 characters).
public static class NoticeCatalog
{
    public static readonly NoticeKind[] All =
    [
        new("EVACUATE", "Evacuar ahora", Severities.Critical),
        new("SURFACE", "Volver a superficie", Severities.Warning),
        new("SHELTER", "Ir al refugio", Severities.Warning),
        new("HELP_COMING", "Ayuda en camino", Severities.Info),
        new("RECEIVED", "Mensaje recibido", Severities.Info),
        new("REPORT", "Reporta tu estado", Severities.Info),
    ];

    public static NoticeKind? Find(string? code) => All.FirstOrDefault(kind => kind.Code == code);

    public static NoticeKind Get(string code) => Find(code) ?? throw new InvalidOperationException($"Unknown notice code {code}.");
}
