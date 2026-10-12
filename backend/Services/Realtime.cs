using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using System.Security.Claims;

namespace MiningSystem.Services;

[Authorize(Roles = "Admin,Supervisor")]
public sealed class MiningHub(LiveSessions sessions) : Hub
{
    public override Task OnConnectedAsync()
    {
        sessions.Add(Context);
        return base.OnConnectedAsync();
    }
    public override Task OnDisconnectedAsync(Exception? exception)
    {
        sessions.Remove(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}

public sealed class LiveSessions
{
    private readonly ConcurrentDictionary<string, HubCallerContext> connections = new();
    public void Add(HubCallerContext context) => connections[context.ConnectionId] = context;
    public void Remove(string id) => connections.TryRemove(id, out _);
    public void Revoke(string userId)
    {
        foreach (var context in connections.Values)
            if (context.User?.FindFirstValue(ClaimTypes.NameIdentifier) == userId) context.Abort();
    }
    public async Task Validate(MiningDb db)
    {
        foreach (var context in connections.Values)
        {
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == context.User!.FindFirstValue(ClaimTypes.NameIdentifier));
            var expires = context.User?.FindFirstValue("expires");
            if (user is null || !user.Active || user.SessionVersion != context.User?.FindFirstValue("version") ||
                !long.TryParse(expires, out var until) || DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= until)
                context.Abort();
        }
    }
}

// Serialize administrative invariants and duplicate device frames in this single-server deployment.
public sealed class MutationLock { public SemaphoreSlim Gate { get; } = new(1, 1); }

public sealed class PresenceWorker(IServiceScopeFactory scopes, IHubContext<MiningHub> hub, LiveSessions sessions) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var previous = "";
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<MiningDb>();
                await sessions.Validate(db);
                var cutoff = DateTime.UtcNow.AddSeconds(-90);
                var online = await db.Devices.AsNoTracking().Where(x => x.Active && x.LastSeenAt > cutoff).OrderBy(x => x.Id).Select(x => x.Id).ToListAsync(stoppingToken);
                var current = string.Join(',', online);
                if (current != previous)
                {
                    previous = current;
                    await hub.Clients.All.SendAsync("SystemChanged", "presence", stoppingToken);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
