using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using MiningSystem.DTOs;

namespace MiningSystem.Realtime;

// One open socket of a device. Sends are serialized because the central may push a notice
// while it answers a frame.
public sealed class DeviceConnection(string deviceId, WebSocket socket)
{
    private readonly SemaphoreSlim sendLock = new(1, 1);

    public string DeviceId { get; } = deviceId;

    public async Task SendAsync<T>(T frame, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(frame, DeviceJson.Options);
        await sendLock.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
                await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally { sendLock.Release(); }
    }

    public async Task CloseAsync(WebSocketCloseStatus status, string reason)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await sendLock.WaitAsync(timeout.Token);
            try
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    await socket.CloseOutputAsync(status, reason, timeout.Token);
            }
            finally { sendLock.Release(); }
        }
        catch (Exception error) when (error is OperationCanceledException or WebSocketException or ObjectDisposedException)
        {
            socket.Abort();
        }
    }
}

public sealed class DeviceConnections
{
    private readonly ConcurrentDictionary<string, DeviceConnection> connections = new();

    // A device keeps a single socket; a new connection replaces the previous one.
    public void Register(DeviceConnection connection)
    {
        DeviceConnection? previous = null;
        connections.AddOrUpdate(connection.DeviceId, connection, (_, existing) => { previous = existing; return connection; });
        if (previous is not null && !ReferenceEquals(previous, connection))
            _ = previous.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Reemplazada por una nueva conexión");
    }

    public void Unregister(DeviceConnection connection) =>
        connections.TryRemove(new KeyValuePair<string, DeviceConnection>(connection.DeviceId, connection));

    public bool IsConnected(string deviceId) => connections.ContainsKey(deviceId);

    public async Task<bool> TrySendAsync<T>(string deviceId, T frame, CancellationToken cancellationToken)
    {
        if (!connections.TryGetValue(deviceId, out var connection)) return false;
        try
        {
            await connection.SendAsync(frame, cancellationToken);
            return true;
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or OperationCanceledException)
        {
            return false;
        }
    }

    // Revoked credential or disabled device: close its live socket at once.
    public Task DisconnectAsync(string deviceId, string reason) =>
        connections.TryRemove(deviceId, out var connection)
            ? connection.CloseAsync(WebSocketCloseStatus.PolicyViolation, reason)
            : Task.CompletedTask;
}
