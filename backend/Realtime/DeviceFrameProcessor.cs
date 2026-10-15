using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Realtime;

public sealed class DeviceAuthenticator(MiningDb db)
{
    // Checked on connection and on every frame, so revocation applies immediately.
    public async Task<MiningDevice?> AuthenticateAsync(string? key, CancellationToken cancellationToken)
    {
        if (!DeviceKeys.HasValidFormat(key)) return null;
        var hash = DeviceKeys.Hash(key!);
        return await db.Devices.Include(x => x.User).FirstOrDefaultAsync(x => x.KeyHash == hash && x.Active, cancellationToken);
    }
}

public sealed class DeviceFrameProcessor(
    DeviceAuthenticator authenticator,
    MiningDb db,
    MessageService messages,
    TelemetryService telemetry,
    NoticeService notices,
    DevicePresence presence,
    IHubContext<MiningHub, IMiningClient> hub,
    TimeProvider time)
{
    public async Task<AckFrame> ProcessAsync(string key, DeviceFrame frame, CancellationToken cancellationToken)
    {
        var device = await authenticator.AuthenticateAsync(key, cancellationToken)
            ?? throw new DeviceProtocolException("Credencial inválida o manilla desactivada.", DeviceErrorCodes.Unauthorized);
        if (device.User is { Active: false })
            throw new DeviceProtocolException("El minero está desactivado.", DeviceErrorCodes.Unauthorized);

        var now = time.UtcNow();
        var wasOnline = presence.IsOnline(device, now);
        AckFrame ack;
        switch (frame.Type)
        {
            case DeviceFrameTypes.Heartbeat:
                device.LastSeenAt = now;
                await db.SaveChangesAsync(cancellationToken);
                ack = new AckFrame(null, null, false, now, new DeviceIdentity(device.Name, device.User?.Name, device.Zone));
                break;
            case DeviceFrameTypes.Telemetry:
                await telemetry.RecordAsync(device, frame, now, cancellationToken);
                ack = new AckFrame(null, null, false, now);
                break;
            case DeviceFrameTypes.Message:
                var (message, duplicate) = await messages.RecordFromDeviceAsync(device, frame, now, cancellationToken);
                ack = new AckFrame(frame.ClientMessageId, message.Id, duplicate, now);
                break;
            case DeviceFrameTypes.NoticeAck:
                await notices.AcknowledgeAsync(device, frame, now, cancellationToken);
                ack = new AckFrame(null, null, false, now, NoticeId: frame.NoticeId);
                break;
            default:
                throw new DeviceProtocolException("Tipo de evento no válido.");
        }
        if (!wasOnline) await hub.Clients.All.SystemChanged(ChangeCategories.Presence);
        return ack;
    }
}
