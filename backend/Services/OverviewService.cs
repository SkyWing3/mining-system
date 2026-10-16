using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;

namespace MiningSystem.Services;

public sealed class OverviewService(MiningDb db, TelemetryService telemetry, DevicePresence presence, TimeProvider time)
{
    public async Task<OverviewDto> GetAsync(CancellationToken cancellationToken)
    {
        var now = time.UtcNow();
        var today = Clock.StartOfLocalDayUtc(now);
        var cutoff = presence.Cutoff(now);
        var critical = MessageCatalog.CodesWithSeverity(Severities.Critical);

        var active = await db.Devices.AsNoTracking().Where(x => x.Active).Select(x => new { x.Id, x.LastSeenAt }).ToListAsync(cancellationToken);
        var online = active.Where(x => x.LastSeenAt > cutoff).Select(x => x.Id).ToList();
        var latest = await telemetry.LatestAsync(online, cancellationToken);
        // Only recent readings of connected devices count as a current danger.
        var liveDanger = latest.Values.Count(x => x is { Level: AlertLevels.Danger } && x.ReceivedAt > cutoff);

        var recent = await db.Messages.AsNoTracking().OrderByDescending(x => x.Id).Take(8).ToListAsync(cancellationToken);
        return new OverviewDto(
            TotalDevices: active.Count,
            OnlineDevices: online.Count,
            ActiveMiners: await db.Users.CountAsync(x => x.Active && x.Role == Roles.Miner, cancellationToken),
            MessagesToday: await db.Messages.CountAsync(x => x.ReceivedAt >= today, cancellationToken),
            PendingAlerts: await db.Messages.CountAsync(x => critical.Contains(x.Code) && x.ReviewedAt == null, cancellationToken),
            LiveDanger: liveDanger,
            PendingVoice: await db.VoiceMessages.CountAsync(x => x.ReviewedAt == null, cancellationToken),
            PendingNotices: await db.Notices.CountAsync(x => x.ReadAt == null && x.ExpiresAt > now, cancellationToken),
            ServerTime: now,
            RecentMessages: recent.Select(MessageDto.From).ToList(),
            Catalog: MessageCatalog.All,
            NoticeCatalog: NoticeCatalog.All);
    }

    public async Task<IReadOnlyList<AuditEventDto>> RecentEventsAsync(CancellationToken cancellationToken) =>
        (await db.Events.AsNoTracking().OrderByDescending(x => x.Id).Take(100).ToListAsync(cancellationToken)).Select(AuditEventDto.From).ToList();
}
