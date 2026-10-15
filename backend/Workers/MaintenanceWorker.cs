using Microsoft.AspNetCore.SignalR;
using MiningSystem.Domain;
using MiningSystem.Realtime;
using MiningSystem.Services;

namespace MiningSystem.Workers;

// Announces notices that expired before reaching their device, so open views refresh their status.
// Stored readings are never purged: the database keeps them append-only (AddDatabaseSecurityPolicies).
public sealed class MaintenanceWorker(
    IServiceScopeFactory scopes,
    IHubContext<MiningHub, IMiningClient> hub,
    TimeProvider time,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastCheck = time.UtcNow();
        using var timer = new PeriodicTimer(Interval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                var now = time.UtcNow();
                try
                {
                    using var scope = scopes.CreateScope();
                    if (await scope.ServiceProvider.GetRequiredService<NoticeService>().CountNewlyExpiredAsync(lastCheck, now, stoppingToken) > 0)
                        await hub.Clients.All.SystemChanged(ChangeCategories.Notices);
                    lastCheck = now;
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    logger.LogWarning(error, "Maintenance failed; retrying on the next tick");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
