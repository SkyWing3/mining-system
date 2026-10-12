using System.ComponentModel.DataAnnotations;

namespace MiningSystem.DTOs;

public sealed record LoginRequest([Required, EmailAddress, MaxLength(180)] string Email, [Required, MaxLength(128)] string Password);
public sealed record SetupRequest([Required, MinLength(2), MaxLength(100)] string Name, [Required, EmailAddress, MaxLength(180)] string Email, [Required, MinLength(10), MaxLength(128)] string Password);
public sealed record UserRequest([Required, MinLength(2), MaxLength(100)] string Name, [Required, EmailAddress, MaxLength(180)] string Email, [Required] string Role, bool Active = true, [MinLength(10), MaxLength(128)] string? Password = null);
public sealed record DeviceRequest([Required, MinLength(2), MaxLength(60)] string Name, [Required, MinLength(2), MaxLength(100)] string Zone, string? UserId, bool Active = true);
public sealed record PasswordRequest([Required] string CurrentPassword, [Required, MinLength(10), MaxLength(128)] string NewPassword);
public sealed record DeviceFrame(string Type, string? ClientMessageId, string? Code, DateTime? SentAt, double? TemperatureC, double? GasPpm, double? BatteryPercent);
