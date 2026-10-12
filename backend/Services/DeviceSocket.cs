using System.Net.WebSockets;
using System.Text.Json;
using MiningSystem.DTOs;

namespace MiningSystem.Services;

public static class DeviceSocket
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task Handle(HttpContext context, IServiceScopeFactory scopes)
    {
        var key = context.Request.Headers["X-Device-Key"].ToString();
        using (var scope = scopes.CreateScope())
        {
            if (await scope.ServiceProvider.GetRequiredService<DeviceIngestion>().Authenticate(key) is null)
            { context.Response.StatusCode = 401; return; }
        }
        if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = 400; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var buffer = new byte[2048];
        try
        {
            while (socket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                timeout.CancelAfter(TimeSpan.FromSeconds(75));
                using var payload = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, timeout.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Hasta pronto", context.RequestAborted); return; }
                    if (result.MessageType != WebSocketMessageType.Text || payload.Length + result.Count > 8192)
                    { await socket.CloseOutputAsync(WebSocketCloseStatus.MessageTooBig, "Solo JSON de hasta 8 KB", context.RequestAborted); return; }
                    payload.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                object response;
                try
                {
                    var frame = JsonSerializer.Deserialize<DeviceFrame>(payload.ToArray(), JsonOptions) ?? throw new JsonException();
                    using var scope = scopes.CreateScope();
                    response = await scope.ServiceProvider.GetRequiredService<DeviceIngestion>().Process(key, frame);
                }
                catch (JsonException) { response = new { type = "error", message = "JSON inválido." }; }
                catch (DeviceProtocolException error)
                {
                    response = new { type = "error", message = error.Message };
                    if (error.Unauthorized)
                    { await socket.CloseOutputAsync(WebSocketCloseStatus.PolicyViolation, error.Message, context.RequestAborted); return; }
                }
                await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions), WebSocketMessageType.Text, true, context.RequestAborted);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
    }
}
