using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.Realtime;
using MiningSystem.Services;

namespace MiningSystem.Workers;

// Every 15 s: close browser sessions that were revoked or expired, and announce presence changes.
public sealed class PresenceWorker(
    IServiceScopeFactory scopes,
    IHubContext<MiningHub, IMiningClient> hub,
    LiveSessions sessions,
    DevicePresence presence,
    TimeProvider time,
    ILogger<PresenceWorker> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var previous = "";
        using var timer = new PeriodicTimer(Interval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<MiningDb>();
                    var now = time.UtcNow();
                    await sessions.Validate(db, now, stoppingToken);
                    var cutoff = presence.Cutoff(now);
                    var online = await db.Devices.AsNoTracking()
                        .Where(x => x.Active && x.LastSeenAt > cutoff)
                        .OrderBy(x => x.Id).Select(x => x.Id)
                        .ToListAsync(stoppingToken);
                    var current = string.Join(',', online);
                    if (current == previous) continue;
                    previous = current;
                    await hub.Clients.All.SystemChanged(ChangeCategories.Presence);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    logger.LogWarning(error, "Presence check failed; retrying on the next tick");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
