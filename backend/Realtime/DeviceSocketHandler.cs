using System.Net.WebSockets;
using System.Text.Json;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Realtime;

// /ws/device: JSON text frames up to 8 KB. The device sends one request at a time and the
// central answers each with ack/error; notices may be pushed at any moment.
public sealed class DeviceSocketHandler(IServiceScopeFactory scopes, DeviceConnections connections, ILogger<DeviceSocketHandler> logger)
{
    public const int MaxFrameBytes = 8192;
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(75);

    public async Task HandleAsync(HttpContext context)
    {
        var key = context.Request.Headers["X-Device-Key"].ToString();
        string deviceId;
        using (var scope = scopes.CreateScope())
        {
            var device = await scope.ServiceProvider.GetRequiredService<DeviceAuthenticator>().AuthenticateAsync(key, context.RequestAborted);
            if (device is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            deviceId = device.Id;
        }
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var connection = new DeviceConnection(deviceId, socket);
        connections.Register(connection);
        try
        {
            await ReceiveLoopAsync(context, socket, connection, key);
        }
        catch (Exception error) when (error is OperationCanceledException or WebSocketException)
        {
            logger.LogDebug("Device {DeviceId} socket ended: {Reason}", deviceId, error.Message);
        }
        finally
        {
            connections.Unregister(connection);
        }
    }

    private async Task ReceiveLoopAsync(HttpContext context, WebSocket socket, DeviceConnection connection, string key)
    {
        var buffer = new byte[2048];
        var noticesSent = false;
        while (socket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(IdleTimeout);
            using var payload = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, timeout.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await connection.CloseAsync(WebSocketCloseStatus.NormalClosure, "Hasta pronto");
                    return;
                }
                if (result.MessageType != WebSocketMessageType.Text || payload.Length + result.Count > MaxFrameBytes)
                {
                    await connection.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Solo JSON de hasta 8 KB");
                    return;
                }
                payload.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var (response, close) = await ProcessAsync(key, payload.ToArray(), context.RequestAborted);
            await connection.SendAsync(response, context.RequestAborted);
            if (close is not null)
            {
                await connection.CloseAsync(WebSocketCloseStatus.PolicyViolation, close);
                return;
            }
            if (!noticesSent && response is AckFrame)
            {
                noticesSent = true;
                await SendPendingNoticesAsync(connection, context.RequestAborted);
            }
        }
    }

    private async Task<(object Response, string? Close)> ProcessAsync(string key, byte[] payload, CancellationToken cancellationToken)
    {
        try
        {
            var frame = JsonSerializer.Deserialize<DeviceFrame>(payload, DeviceJson.Options) ?? throw new JsonException();
            using var scope = scopes.CreateScope();
            var ack = await scope.ServiceProvider.GetRequiredService<DeviceFrameProcessor>().ProcessAsync(key, frame, cancellationToken);
            return (ack, null);
        }
        catch (JsonException)
        {
            return (new ErrorFrame(DeviceErrorCodes.Invalid, "JSON inválido."), null);
        }
        catch (DeviceProtocolException error)
        {
            return (new ErrorFrame(error.Code, error.Message), error.Unauthorized ? error.Message : null);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Storage failures are transient: the device keeps the frame queued and retries.
            logger.LogError(error, "Could not process a device frame");
            return (new ErrorFrame(DeviceErrorCodes.Unavailable, "La central no pudo guardar el evento. Se reintentará."), null);
        }
    }

    private async Task SendPendingNoticesAsync(DeviceConnection connection, CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var frames = await scope.ServiceProvider.GetRequiredService<NoticeService>().PendingFramesAsync(connection.DeviceId, cancellationToken);
        foreach (var frame in frames) await connection.SendAsync(frame, cancellationToken);
    }
}
