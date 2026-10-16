using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

public sealed class DeviceService(
    MiningDb db,
    TelemetryService telemetry,
    DevicePresence presence,
    MutationLock mutations,
    DeviceConnections connections,
    IHubContext<MiningHub, IMiningClient> hub,
    TimeProvider time)
{
    public async Task<IReadOnlyList<DeviceDto>> ListAsync(CancellationToken cancellationToken)
    {
        var devices = await db.Devices.AsNoTracking().Include(x => x.User).OrderBy(x => x.Name).ToListAsync(cancellationToken);
        var latest = await telemetry.LatestAsync(devices.Select(x => x.Id), cancellationToken);
        var now = time.UtcNow();
        return devices.Select(x => DeviceDto.From(x, presence.IsOnline(x, now), latest.GetValueOrDefault(x.Id))).ToList();
    }

    public async Task<IReadOnlyList<UserDto>> ListMinersAsync(CancellationToken cancellationToken) =>
        (await db.Users.AsNoTracking().Where(x => x.Role == Roles.Miner && x.Active).OrderBy(x => x.Name).ToListAsync(cancellationToken))
        .Select(UserDto.From).ToList();

    public async Task<DeviceSavedDto> SaveAsync(string? id, DeviceRequest request, Actor actor, CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        var zone = request.Zone.Trim();
        if (name.Length < 2 || zone.Length < 2) throw DomainException.Invalid("Indica un nombre y una zona válidos.");

        string? apiKey = null;
        MiningDevice device;
        using (await mutations.AcquireAsync(cancellationToken))
        {
            if (await db.Devices.AnyAsync(x => x.Name == name && x.Id != id, cancellationToken))
                throw DomainException.Conflict("Ya existe una manilla con ese nombre.");
            if (request.UserId is not null && !await db.Users.AnyAsync(x => x.Id == request.UserId && x.Active && x.Role == Roles.Miner, cancellationToken))
                throw DomainException.Invalid("Selecciona un minero activo.");
            if (request.UserId is not null && request.Active && await db.Devices.AnyAsync(x => x.Id != id && x.UserId == request.UserId && x.Active, cancellationToken))
                throw DomainException.Conflict("El minero ya tiene una manilla activa asignada.");

            var now = time.UtcNow();
            device = id is null
                ? new MiningDevice { CreatedAt = now }
                : await db.Devices.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                  ?? throw DomainException.NotFound("Manilla no encontrada.");
            device.Name = name;
            device.Zone = zone;
            device.UserId = request.UserId;
            device.Active = request.Active;
            if (id is null)
            {
                apiKey = DeviceKeys.Generate();
                device.KeyHash = DeviceKeys.Hash(apiKey);
                db.Devices.Add(device);
            }
            db.Audit(actor.Name, $"{(id is null ? "Registró" : "Actualizó")} la manilla {device.Name}.", now);
            await db.SaveChangesAsync(cancellationToken);
            // Loaded after saving so the response reflects the new assignment.
            if (device.UserId is not null) await db.Entry(device).Reference(x => x.User).LoadAsync(cancellationToken);
        }

        if (!device.Active) await connections.DisconnectAsync(device.Id, "Manilla deshabilitada");
        await hub.Clients.All.SystemChanged(ChangeCategories.Devices);
        var latest = await telemetry.LatestAsync([device.Id], cancellationToken);
        return new DeviceSavedDto(DeviceDto.From(device, presence.IsOnline(device, time.UtcNow()), latest[device.Id]), apiKey);
    }

    public async Task<ApiKeyDto> RotateKeyAsync(string id, Actor actor, CancellationToken cancellationToken)
    {
        var apiKey = DeviceKeys.Generate();
        using (await mutations.AcquireAsync(cancellationToken))
        {
            var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, cancellationToken) ?? throw DomainException.NotFound("Manilla no encontrada.");
            device.KeyHash = DeviceKeys.Hash(apiKey);
            db.Audit(actor.Name, $"Renovó la credencial de {device.Name}.", time.UtcNow());
            await db.SaveChangesAsync(cancellationToken);
        }
        await connections.DisconnectAsync(id, "Credencial renovada");
        await hub.Clients.All.SystemChanged(ChangeCategories.Devices);
        return new ApiKeyDto(apiKey);
    }
}
