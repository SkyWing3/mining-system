using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;

namespace MiningSystem.Realtime;

// Events pushed to the operators' browsers. The hub exposes no methods to reply to miners.
public interface IMiningClient
{
    Task MessageReceived(MessageDto message);
    Task MessageReviewed(MessageDto message);
    Task TelemetryReceived(TelemetryEventDto telemetry);
    Task VoiceMessageReceived(VoiceMessageDto voice);
    Task VoiceMessageReviewed(VoiceMessageDto voice);
    Task NoticeUpdated(NoticeDto notice);
    // Category: users, devices, messages, presence, voice or notices.
    Task SystemChanged(string category);
}

public static class ChangeCategories
{
    public const string Users = "users";
    public const string Devices = "devices";
    public const string Messages = "messages";
    public const string Presence = "presence";
    public const string Voice = "voice";
    public const string Notices = "notices";
}

[Authorize(Roles = Roles.Operators)]
public sealed class MiningHub(LiveSessions sessions) : Hub<IMiningClient>
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

// Browser connections, so revoked or expired sessions can be closed immediately.
public sealed class LiveSessions
{
    private readonly ConcurrentDictionary<string, HubCallerContext> connections = new();

    public void Add(HubCallerContext context) => connections[context.ConnectionId] = context;

    public void Remove(string connectionId) => connections.TryRemove(connectionId, out _);

    public void Revoke(string userId)
    {
        foreach (var context in connections.Values)
            if (context.User?.FindFirstValue(ClaimTypes.NameIdentifier) == userId)
                context.Abort();
    }

    public async Task Validate(MiningDb db, DateTime now, CancellationToken cancellationToken)
    {
        foreach (var context in connections.Values)
        {
            var userId = context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = userId is null ? null : await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, cancellationToken);
            var expires = context.User?.FindFirstValue(SessionClaims.Expires);
            var expired = !long.TryParse(expires, out var until) || new DateTimeOffset(now).ToUnixTimeSeconds() >= until;
            if (user is null || !user.Active || user.SessionVersion != context.User?.FindFirstValue(SessionClaims.Version) || expired)
                context.Abort();
        }
    }
}

public static class SessionClaims
{
    public const string Version = "version";
    public const string Expires = "expires";
}

// Serializes administrative invariants and duplicate device frames in this single-server deployment.
public sealed class MutationLock
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<IDisposable> AcquireAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        return new Releaser(gate);
    }

    private sealed class Releaser(SemaphoreSlim gate) : IDisposable
    {
        private int released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref released, 1) == 0) gate.Release();
        }
    }
}
