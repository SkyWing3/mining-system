using System.ComponentModel.DataAnnotations;

namespace MiningSystem.Configuration;

public sealed class MiningOptions
{
    public const string SectionName = "Mining";
    public static readonly string[] DevelopmentOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

    public string? ConnectionString { get; set; }
    public string? PasswordFile { get; set; }
    public string? DataDirectory { get; set; }
    public string[] AllowedOrigins { get; set; } = [];
    public string[] KnownProxyNetworks { get; set; } = [];

    // A device is shown as connected if it sent a valid frame within this window.
    [Range(30, 600)]
    public int PresenceWindowSeconds { get; set; } = 90;

    // Login and initial setup attempts per IP and minute.
    [Range(3, 1000)]
    public int LoginAttemptsPerMinute { get; set; } = 12;

    [Required]
    public TelemetryOptions Telemetry { get; set; } = new();

    [Required]
    public VoiceOptions Voice { get; set; } = new();

    [Required]
    public NoticeOptions Notices { get; set; } = new();

    public string[] EffectiveOrigins => AllowedOrigins.Length > 0 ? AllowedOrigins : DevelopmentOrigins;
}

public sealed class TelemetryOptions
{
    // Every reading is broadcast live; MySQL keeps at most one per interval and device, plus level changes. 0 keeps all.
    [Range(0, 3600)]
    public int PersistIntervalSeconds { get; set; } = 10;

    // Stored readings older than this are deleted. 0 keeps them forever.
    [Range(0, 3650)]
    public int RetentionDays { get; set; } = 30;
}

public sealed class VoiceOptions
{
    [Range(64 * 1024, 16 * 1024 * 1024)]
    public int MaxBytes { get; set; } = 2 * 1024 * 1024;

    [Range(5, 300)]
    public int MaxSeconds { get; set; } = 60;

    [Range(1, 120)]
    public int UploadsPerMinute { get; set; } = 10;
}

public sealed class NoticeOptions
{
    [Range(1, 1440)]
    public int ExpirationMinutes { get; set; } = 30;
}

// Absolute folders derived from Mining:DataDirectory.
public sealed record MiningPaths(string DataDirectory)
{
    public string KeysDirectory => Path.Combine(DataDirectory, "keys");
    public string VoiceDirectory => Path.Combine(DataDirectory, "voice");
    public string LocalDatabaseSettings => Path.Combine(DataDirectory, "mysql.json");
}
