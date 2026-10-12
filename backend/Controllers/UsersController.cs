using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.DTOs;
using MiningSystem.Models;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/users"), Authorize(Roles = "Admin")]
public sealed class UsersController(MiningDb db, PasswordHasher<User> hasher, MutationLock mutations, LiveSessions sessions, IHubContext<MiningHub> hub) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List() => Ok((await db.Users.AsNoTracking().OrderBy(x => x.Name).ToListAsync()).Select(Views.User));
    [HttpPost]
    public Task<IActionResult> Create(UserRequest request) => Save(null, request);
    [HttpPut("{id}")]
    public Task<IActionResult> Update(string id, UserRequest request) => Save(id, request);

    private async Task<IActionResult> Save(string? id, UserRequest request)
    {
        if (!new[] { "Admin", "Supervisor", "Miner" }.Contains(request.Role) || request.Name.Trim().Length < 2)
            return BadRequest(new { message = "Nombre o rol inválido." });
        if (id is null && string.IsNullOrEmpty(request.Password)) return BadRequest(new { message = "La contraseña es obligatoria al crear un usuario (mínimo 10 caracteres)." });
        await mutations.Gate.WaitAsync();
        try
        {
            var email = request.Email.Trim().ToLowerInvariant();
            if (await db.Users.AnyAsync(x => x.Email == email && x.Id != id)) return Conflict(new { message = "Este correo ya está registrado." });
            var user = id is null ? new User() : await db.Users.FindAsync(id);
            if (user is null) return NotFound(new { message = "Usuario no encontrado." });
            if (user.Id == User.FindFirstValue(ClaimTypes.NameIdentifier) && !request.Active)
                return BadRequest(new { message = "No puedes desactivar tu propia cuenta." });
            if (user.Role == "Admin" && user.Active && (!request.Active || request.Role != "Admin") && await db.Users.CountAsync(x => x.Role == "Admin" && x.Active) <= 1)
                return BadRequest(new { message = "El sistema debe conservar al menos un administrador activo." });
            if ((!request.Active || request.Role != "Miner") && await db.Devices.AnyAsync(x => x.UserId == user.Id && x.Active))
                return BadRequest(new { message = "Desasigna primero las manillas activas de este minero." });
            user.Name = request.Name.Trim(); user.Email = email; user.Role = request.Role; user.Active = request.Active;
            user.SessionVersion = Guid.NewGuid().ToString("N");
            if (!string.IsNullOrEmpty(request.Password)) user.PasswordHash = hasher.HashPassword(user, request.Password);
            if (id is null) db.Users.Add(user);
            db.Events.Add(new AuditEvent { Actor = User.Identity!.Name!, Description = $"{(id is null ? "Creó" : "Actualizó")} el usuario {user.Name}." });
            await db.SaveChangesAsync();
            sessions.Revoke(user.Id);
            await hub.Clients.All.SendAsync("SystemChanged", "users");
            return Ok(Views.User(user));
        }
        finally { mutations.Gate.Release(); }
    }
}
