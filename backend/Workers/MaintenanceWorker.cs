using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.Realtime;
using MiningSystem.Services;

namespace MiningSystem.Workers;

// Announces notices that expired undelivered and applies the telemetry retention period.
public sealed class MaintenanceWorker(
    IServiceScopeFactory scopes,
    IHubContext<MiningHub, IMiningClient> hub,
    IOptions<MiningOptions> options,
    TimeProvider time,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan RetentionInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastCheck = time.UtcNow();
        var nextRetention = lastCheck;
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
                    if (now >= nextRetention)
                    {
                        await PurgeReadingsAsync(scope.ServiceProvider.GetRequiredService<MiningDb>(), now, stoppingToken);
                        nextRetention = now + RetentionInterval;
                    }
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    logger.LogWarning(error, "Maintenance failed; retrying on the next tick");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private async Task PurgeReadingsAsync(MiningDb db, DateTime now, CancellationToken cancellationToken)
    {
        var days = options.Value.Telemetry.RetentionDays;
        if (days <= 0) return;
        var cutoff = now.AddDays(-days);
        var deleted = await db.Readings.Where(x => x.ReceivedAt < cutoff).ExecuteDeleteAsync(cancellationToken);
        if (deleted > 0) logger.LogInformation("Deleted {Count} readings older than {Days} days", deleted, days);
    }
}
