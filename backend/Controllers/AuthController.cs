using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Extensions;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/auth")]
public sealed class AuthController(AuthService auth, TimeProvider time) : ControllerBase
{
    // Public: tells the web whether to show the initial setup, the login, or the current session.
    [HttpGet("status"), AllowAnonymous]
    public async Task<IActionResult> Status(CancellationToken cancellationToken)
    {
        var setupRequired = await auth.IsSetupRequiredAsync(cancellationToken);
        var user = !setupRequired && (User.IsInRole(Roles.Admin) || User.IsInRole(Roles.Supervisor))
            ? await auth.FindAsync(CurrentUserId, cancellationToken)
            : null;
        return Ok(new { setupRequired, user = user is null ? null : UserDto.From(user) });
    }

    [HttpPost("setup"), AllowAnonymous, EnableRateLimiting(RateLimitPolicies.Login)]
    public async Task<ActionResult<UserDto>> Setup(SetupRequest request, CancellationToken cancellationToken)
    {
        var user = await auth.SetupAsync(request, cancellationToken);
        await SessionCookies.SignInAsync(HttpContext, user, time.UtcNow());
        return UserDto.From(user);
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting(RateLimitPolicies.Login)]
    public async Task<ActionResult<UserDto>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var user = await auth.LoginAsync(request, cancellationToken);
        await SessionCookies.SignInAsync(HttpContext, user, time.UtcNow());
        return UserDto.From(user);
    }

    [HttpGet("me"), Authorize(Roles = Roles.Operators)]
    public async Task<ActionResult<UserDto>> Me(CancellationToken cancellationToken) =>
        UserDto.From(await auth.GetAsync(CurrentUserId, cancellationToken));

    [HttpPost("logout"), Authorize]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        await auth.LogoutAsync(CurrentUserId, cancellationToken);
        await HttpContext.SignOutAsync();
        return NoContent();
    }

    [HttpPost("password"), Authorize]
    public async Task<IActionResult> Password(PasswordRequest request, CancellationToken cancellationToken)
    {
        var user = await auth.ChangePasswordAsync(CurrentUserId, request, cancellationToken);
        await SessionCookies.SignInAsync(HttpContext, user, time.UtcNow());
        return NoContent();
    }

    private string CurrentUserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
}
