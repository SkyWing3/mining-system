using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

// Notices travel central → device over the device's own WebSocket and are stored until read.
public sealed class NoticeService(
    MiningDb db,
    DeviceConnections connections,
    IHubContext<MiningHub, IMiningClient> hub,
    IOptions<MiningOptions> options,
    TimeProvider time,
    ILogger<NoticeService> logger)
{
    public const int MaxTargets = 200;

    public async Task<IReadOnlyList<NoticeDto>> CreateAsync(NoticeRequest request, Actor actor, CancellationToken cancellationToken)
    {
        var kind = NoticeCatalog.Find(request.Code) ?? throw DomainException.Invalid("Selecciona un aviso del catálogo.");
        var devices = db.Devices.Include(x => x.User).Where(x => x.Active);
        if (!request.All)
        {
            var ids = (request.DeviceIds ?? []).Distinct().ToArray();
            if (ids.Length is 0 or > MaxTargets) throw DomainException.Invalid("Selecciona al menos una manilla.");
            devices = devices.Where(x => ids.Contains(x.Id));
            if (await devices.CountAsync(cancellationToken) != ids.Length)
                throw DomainException.Invalid("Solo se pueden enviar avisos a manillas habilitadas.");
        }
        var targets = await devices.OrderBy(x => x.Name).ToListAsync(cancellationToken);
        if (targets.Count == 0) throw DomainException.Invalid("No hay manillas habilitadas para recibir el aviso.");

        var now = time.UtcNow();
        var expiresAt = now.AddMinutes(options.Value.Notices.ExpirationMinutes);
        var notices = targets.Select(device => new DeviceNotice
        {
            DeviceId = device.Id,
            Code = kind.Code,
            DeviceName = device.Name,
            MinerName = device.User?.Name,
            Zone = device.Zone,
            CreatedBy = actor.Name,
            CreatedAt = now,
            ExpiresAt = expiresAt,
        }).ToList();
        db.Notices.AddRange(notices);
        var audience = request.All ? "todas las manillas" : notices.Count == 1 ? $"la manilla {notices[0].DeviceName}" : $"{notices.Count} manillas";
        db.Audit(actor.Name, $"Envió el aviso \"{kind.Text}\" a {audience}.", now);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var notice in notices)
        {
            await hub.Clients.All.NoticeUpdated(NoticeDto.From(notice, now));
            await connections.TrySendAsync(notice.DeviceId, ToFrame(notice), cancellationToken);
        }
        await hub.Clients.All.SystemChanged(ChangeCategories.Notices);
        return notices.Select(x => NoticeDto.From(x, now)).ToList();
    }

    public async Task<PagedResult<NoticeDto>> ListAsync(PageQuery query, CancellationToken cancellationToken)
    {
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var now = time.UtcNow();
        var notices = db.Notices.AsNoTracking().AsQueryable();
        if (!string.IsNullOrEmpty(query.DeviceId)) notices = notices.Where(x => x.DeviceId == query.DeviceId);
        if (query.Pending) notices = notices.Where(x => x.ReadAt == null && x.ExpiresAt > now);
        var total = await notices.CountAsync(cancellationToken);
        var rows = await notices.OrderByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        return new PagedResult<NoticeDto>(rows.Select(x => NoticeDto.From(x, now)).ToList(), total, page, pageSize);
    }

    // Unread, unexpired notices; sent again on every connection until the miner reads them.
    public async Task<IReadOnlyList<NoticeFrame>> PendingFramesAsync(string deviceId, CancellationToken cancellationToken)
    {
        var now = time.UtcNow();
        var pending = await db.Notices.AsNoTracking()
            .Where(x => x.DeviceId == deviceId && x.ReadAt == null && x.ExpiresAt > now)
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return pending.Select(ToFrame).ToList();
    }

    public async Task AcknowledgeAsync(MiningDevice device, DeviceFrame frame, DateTime now, CancellationToken cancellationToken)
    {
        if (frame.NoticeId is not { } noticeId || frame.Stage is not (NoticeAckStages.Delivered or NoticeAckStages.Read))
            throw new DeviceProtocolException("Confirmación de aviso inválida.");
        var notice = await db.Notices.FirstOrDefaultAsync(x => x.Id == noticeId && x.DeviceId == device.Id, cancellationToken)
            ?? throw new DeviceProtocolException("Aviso no encontrado.");
        var changed = false;
        if (notice.DeliveredAt is null)
        {
            notice.DeliveredAt = now;
            changed = true;
        }
        if (frame.Stage == NoticeAckStages.Read && notice.ReadAt is null)
        {
            notice.ReadAt = now;
            changed = true;
        }
        device.LastSeenAt = now;
        await db.SaveChangesAsync(cancellationToken);
        if (!changed) return;
        logger.LogInformation("Notice {NoticeId} {Stage} by device {DeviceId}", notice.Id, frame.Stage, device.Id);
        await hub.Clients.All.NoticeUpdated(NoticeDto.From(notice, now));
        await hub.Clients.All.SystemChanged(ChangeCategories.Notices);
    }

    public async Task<int> CountNewlyExpiredAsync(DateTime from, DateTime to, CancellationToken cancellationToken) =>
        await db.Notices.CountAsync(x => x.DeliveredAt == null && x.ExpiresAt > from && x.ExpiresAt <= to, cancellationToken);

    private static NoticeFrame ToFrame(DeviceNotice notice)
    {
        var kind = NoticeCatalog.Get(notice.Code);
        return new NoticeFrame(notice.Id, kind.Code, kind.Text, kind.Severity, notice.CreatedAt, notice.ExpiresAt);
    }
}
