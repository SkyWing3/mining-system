using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Models;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api"), Authorize(Roles = "Admin,Supervisor")]
public sealed class MonitoringController(MiningDb db, MutationLock mutations, IHubContext<MiningHub> hub) : ControllerBase
{
    [HttpGet("overview")]
    public async Task<IActionResult> Overview()
    {
        var today = DateTime.UtcNow.AddHours(-4).Date.AddHours(4); var cutoff = DateTime.UtcNow.AddSeconds(-90);
        var critical = MessageCatalog.All.Where(x => x.Severity == "critical").Select(x => x.Code).ToArray();
        return Ok(new
        {
            totalDevices = await db.Devices.CountAsync(x => x.Active),
            onlineDevices = await db.Devices.CountAsync(x => x.Active && x.LastSeenAt > cutoff),
            activeMiners = await db.Users.CountAsync(x => x.Active && x.Role == "Miner"),
            messagesToday = await db.Messages.CountAsync(x => x.ReceivedAt >= today),
            pendingAlerts = await db.Messages.CountAsync(x => critical.Contains(x.Code) && x.ReviewedAt == null),
            serverTime = DateTime.UtcNow,
            recentMessages = (await db.Messages.AsNoTracking().OrderByDescending(x => x.Id).Take(8).ToListAsync()).Select(Views.Message),
            catalog = MessageCatalog.All
        });
    }
    [HttpGet("messages")]
    public async Task<IActionResult> Messages(int page = 1, int pageSize = 25, string? search = null, string? severity = null, string? deviceId = null, bool pending = false)
    {
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.Messages.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var codes = MessageCatalog.All.Where(x => x.Text.Contains(term, StringComparison.OrdinalIgnoreCase)).Select(x => x.Code).ToArray();
            query = query.Where(x => x.MinerName.Contains(term) || x.DeviceName.Contains(term) || x.Zone.Contains(term) || codes.Contains(x.Code));
        }
        if (severity is not null)
        {
            var codes = MessageCatalog.All.Where(x => x.Severity == severity).Select(x => x.Code).ToArray();
            query = query.Where(x => codes.Contains(x.Code));
        }
        if (deviceId is not null) query = query.Where(x => x.DeviceId == deviceId);
        if (pending) query = query.Where(x => x.ReviewedAt == null);
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { items = rows.Select(Views.Message), total, page, pageSize });
    }
    [HttpPost("messages/{id:long}/review")]
    public async Task<IActionResult> Review(long id)
    {
        await mutations.Gate.WaitAsync();
        try
        {
            var message = await db.Messages.FindAsync(id);
            if (message is null) return NotFound(new { message = "Mensaje no encontrado." });
            if (MessageCatalog.Find(message.Code)!.Severity != "critical") return BadRequest(new { message = "Solo las alertas críticas requieren revisión." });
            if (message.ReviewedAt is null)
            {
                message.ReviewedAt = DateTime.UtcNow; message.ReviewedBy = User.Identity!.Name;
                db.Events.Add(new AuditEvent { Actor = User.Identity!.Name!, Description = $"Marcó como revisada la alerta #{message.Id}: {MessageCatalog.Find(message.Code)!.Text}." });
                await db.SaveChangesAsync();
                await hub.Clients.All.SendAsync("MessageReviewed", Views.Message(message));
                await hub.Clients.All.SendAsync("SystemChanged", "messages");
            }
            return Ok(Views.Message(message));
        }
        finally { mutations.Gate.Release(); }
    }
    [HttpGet("events")]
    public async Task<IActionResult> Events() => Ok(await db.Events.AsNoTracking().OrderByDescending(x => x.Id).Take(100).ToListAsync());
    [HttpGet("devices/{id}/telemetry")]
    public async Task<IActionResult> Readings(string id)
    {
        if (!await db.Devices.AnyAsync(x => x.Id == id)) return NotFound();
        return Ok(await db.Readings.AsNoTracking().Where(x => x.DeviceId == id).OrderByDescending(x => x.Id).Take(100).Select(x => new { x.Id, x.MinerName, x.Zone, x.TemperatureC, x.GasPpm, x.BatteryPercent, x.ReceivedAt }).ToListAsync());
    }
}
