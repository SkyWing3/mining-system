using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.DTOs;
using MiningSystem.Models;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/auth")]
public sealed class AuthController(MiningDb db, PasswordHasher<User> hasher, MutationLock mutations, LiveSessions sessions) : ControllerBase
{
    [HttpGet("status"), AllowAnonymous]
    public async Task<IActionResult> Status() => Ok(new { setupRequired = !await db.Users.AnyAsync() });

    [HttpPost("setup"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<IActionResult> Setup(SetupRequest request)
    {
        await mutations.Gate.WaitAsync();
        try
        {
            if (await db.Users.AnyAsync()) return Conflict(new { message = "La cuenta inicial ya fue creada." });
            if (request.Name.Trim().Length < 2) return BadRequest(new { message = "Escribe un nombre válido." });
            var user = new User { Name = request.Name.Trim(), Email = request.Email.Trim().ToLowerInvariant(), Role = "Admin" };
            user.PasswordHash = hasher.HashPassword(user, request.Password);
            db.Users.Add(user);
            db.Events.Add(new AuditEvent { Actor = user.Name, Description = "Configuró el sistema y creó la cuenta de administración." });
            await db.SaveChangesAsync();
            await SignIn(user);
            return Ok(Views.User(user));
        }
        finally { mutations.Gate.Release(); }
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Email == request.Email.Trim().ToLowerInvariant());
        if (user is null || !user.Active || hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password) == PasswordVerificationResult.Failed)
            return Unauthorized(new { message = "Correo o contraseña incorrectos." });
        if (user.Role == "Miner") return StatusCode(403, new { message = "Las cuentas de mineros se utilizan en las manillas. El panel requiere un supervisor o administrador." });
        await SignIn(user);
        return Ok(Views.User(user));
    }

    [HttpGet("me"), Authorize(Roles = "Admin,Supervisor")]
    public async Task<IActionResult> Me() => Ok(Views.User((await db.Users.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)))!));

    [HttpPost("logout"), Authorize]
    public async Task<IActionResult> Logout()
    {
        var user = (await db.Users.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)))!;
        user.SessionVersion = Guid.NewGuid().ToString("N");
        await db.SaveChangesAsync();
        sessions.Revoke(user.Id);
        await HttpContext.SignOutAsync();
        return NoContent();
    }

    [HttpPost("password"), Authorize]
    public async Task<IActionResult> Password(PasswordRequest request)
    {
        var user = (await db.Users.FindAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)))!;
        if (hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
            return BadRequest(new { message = "La contraseña actual es incorrecta." });
        user.PasswordHash = hasher.HashPassword(user, request.NewPassword);
        user.SessionVersion = Guid.NewGuid().ToString("N");
        db.Events.Add(new AuditEvent { Actor = user.Name, Description = "Cambió su contraseña." });
        await db.SaveChangesAsync();
        sessions.Revoke(user.Id);
        await SignIn(user);
        return NoContent();
    }

    private Task SignIn(User user)
    {
        var expires = DateTimeOffset.UtcNow.AddHours(8);
        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.Name),
            new Claim(ClaimTypes.Role, user.Role), new Claim("version", user.SessionVersion),
            new Claim("expires", expires.ToUnixTimeSeconds().ToString())
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        return HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), new AuthenticationProperties { ExpiresUtc = expires });
    }
}
