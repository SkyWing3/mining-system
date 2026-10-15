using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Domain;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

// The authenticated operator performing an action, as recorded in the audit log.
public sealed record Actor(string Id, string Name);

public static class ActorExtensions
{
    public static Actor ToActor(this ClaimsPrincipal principal) => new(
        principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Missing user identifier."),
        principal.Identity?.Name ?? throw new InvalidOperationException("Missing user name."));
}

public static class DeviceKeys
{
    // 32 random bytes as 64 hexadecimal characters; only the SHA-256 hash is stored.
    public static string Generate() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    public static bool HasValidFormat(string? key) => key is { Length: 64 } && key.All(Uri.IsHexDigit);
}

public sealed class DevicePresence(IOptions<MiningOptions> options)
{
    public DateTime Cutoff(DateTime now) => now.AddSeconds(-options.Value.PresenceWindowSeconds);

    public bool IsOnline(MiningDevice device, DateTime now) => device.Active && device.LastSeenAt > Cutoff(now);
}

public static class SessionCookies
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(8);

    public static Task SignInAsync(HttpContext context, User user, DateTime now)
    {
        var expires = new DateTimeOffset(now).Add(Lifetime);
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.Name),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim(SessionClaims.Version, user.SessionVersion),
            new Claim(SessionClaims.Expires, expires.ToUnixTimeSeconds().ToString()),
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        return context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { ExpiresUtc = expires });
    }
}

public static class Paging
{
    public const int MaxPageSize = 100;

    public static (int Page, int PageSize) Normalize(int page, int pageSize) => (Math.Max(1, page), Math.Clamp(pageSize, 1, MaxPageSize));
}
