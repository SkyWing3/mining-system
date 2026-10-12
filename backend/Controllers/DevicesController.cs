using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.DTOs;
using MiningSystem.Models;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/devices"), Authorize(Roles = "Admin,Supervisor")]
public sealed class DevicesController(MiningDb db, MutationLock mutations, IHubContext<MiningHub> hub) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var devices = await db.Devices.AsNoTracking().Include(x => x.User).OrderBy(x => x.Name).ToListAsync();
        var latest = await db.Readings.AsNoTracking().Where(x => x.Id == db.Readings.Where(y => y.DeviceId == x.DeviceId).Max(y => y.Id)).ToListAsync();
        return Ok(devices.Select(x => Views.Device(x, latest.FirstOrDefault(y => y.DeviceId == x.Id))));
    }
    [HttpGet("miners")]
    public async Task<IActionResult> Miners() => Ok((await db.Users.AsNoTracking().Where(x => x.Role == "Miner" && x.Active).OrderBy(x => x.Name).ToListAsync()).Select(Views.User));
    [HttpPost]
    public Task<IActionResult> Create(DeviceRequest request) => Save(null, request);
    [HttpPut("{id}")]
    public Task<IActionResult> Update(string id, DeviceRequest request) => Save(id, request);

    private async Task<IActionResult> Save(string? id, DeviceRequest request)
    {
        if (request.Name.Trim().Length < 2 || request.Zone.Trim().Length < 2) return BadRequest(new { message = "Indica un nombre y una zona válidos." });
        await mutations.Gate.WaitAsync();
        try
        {
            if (await db.Devices.AnyAsync(x => x.Name == request.Name.Trim() && x.Id != id)) return Conflict(new { message = "Ya existe una manilla con ese nombre." });
            if (request.UserId is not null && !await db.Users.AnyAsync(x => x.Id == request.UserId && x.Active && x.Role == "Miner")) return BadRequest(new { message = "Selecciona un minero activo." });
            if (request.UserId is not null && request.Active && await db.Devices.AnyAsync(x => x.Id != id && x.UserId == request.UserId && x.Active)) return Conflict(new { message = "El minero ya tiene una manilla activa asignada." });
            var device = id is null ? new MiningDevice() : await db.Devices.FindAsync(id);
            if (device is null) return NotFound(new { message = "Manilla no encontrada." });
            var apiKey = id is null ? NewKey() : null;
            device.Name = request.Name.Trim(); device.Zone = request.Zone.Trim(); device.UserId = request.UserId; device.Active = request.Active;
            if (apiKey is not null) device.KeyHash = DeviceIngestion.HashKey(apiKey);
            if (id is null) db.Devices.Add(device);
            db.Events.Add(new AuditEvent { Actor = User.Identity!.Name!, Description = $"{(id is null ? "Registró" : "Actualizó")} la manilla {device.Name}." });
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SystemChanged", "devices");
            return Ok(new { device = Views.Device(device), apiKey });
        }
        finally { mutations.Gate.Release(); }
    }

    [HttpPost("{id}/rotate-key")]
    public async Task<IActionResult> Rotate(string id)
    {
        await mutations.Gate.WaitAsync();
        try
        {
            var device = await db.Devices.FindAsync(id);
            if (device is null) return NotFound(new { message = "Manilla no encontrada." });
            var apiKey = NewKey(); device.KeyHash = DeviceIngestion.HashKey(apiKey);
            db.Events.Add(new AuditEvent { Actor = User.Identity!.Name!, Description = $"Renovó la credencial de {device.Name}." });
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SystemChanged", "devices");
            return Ok(new { apiKey });
        }
        finally { mutations.Gate.Release(); }
    }
    private static string NewKey() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
}
