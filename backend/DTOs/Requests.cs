using System.ComponentModel.DataAnnotations;

namespace MiningSystem.DTOs;

public sealed record LoginRequest(
    [Required, EmailAddress, MaxLength(180)] string Email,
    [Required, MaxLength(128)] string Password);

public sealed record SetupRequest(
    [Required, MinLength(2), MaxLength(100)] string Name,
    [Required, EmailAddress, MaxLength(180)] string Email,
    [Required, MinLength(10), MaxLength(128)] string Password);

public sealed record UserRequest(
    [Required, MinLength(2), MaxLength(100)] string Name,
    [Required, EmailAddress, MaxLength(180)] string Email,
    [Required] string Role,
    bool Active = true,
    [MinLength(10), MaxLength(128)] string? Password = null);

public sealed record DeviceRequest(
    [Required, MinLength(2), MaxLength(60)] string Name,
    [Required, MinLength(2), MaxLength(100)] string Zone,
    string? UserId,
    bool Active = true);

public sealed record PasswordRequest(
    [Required] string CurrentPassword,
    [Required, MinLength(10), MaxLength(128)] string NewPassword);

public sealed record NoticeRequest(
    [Required, MaxLength(24)] string Code,
    [MaxLength(200)] string[]? DeviceIds,
    bool All = false);

public sealed class MessageQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 25;
    public string? Search { get; init; }
    public string? Severity { get; init; }
    public string? DeviceId { get; init; }
    public bool Pending { get; init; }
}

public sealed class PageQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 25;
    public string? DeviceId { get; init; }
    public bool Pending { get; init; }
}

public sealed class TelemetryQuery
{
    public DateTime? Since { get; init; }
    public int Limit { get; init; } = 100;
}
