using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

public sealed class MessageService(MiningDb db, MutationLock mutations, IHubContext<MiningHub, IMiningClient> hub, TimeProvider time)
{
    // Accent- and case-insensitive search; the columns themselves keep a binary collation.
    private const string SearchCollation = "utf8mb4_0900_ai_ci";
    public const int MaxDetailLength = 120;

    public async Task<PagedResult<MessageDto>> ListAsync(MessageQuery query, CancellationToken cancellationToken)
    {
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var messages = db.Messages.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            var codes = MessageCatalog.All.Where(x => MatchesText(x.Text, term)).Select(x => x.Code).ToArray();
            messages = messages.Where(x =>
                EF.Functions.Collate(x.MinerName, SearchCollation).Contains(term) ||
                EF.Functions.Collate(x.DeviceName, SearchCollation).Contains(term) ||
                EF.Functions.Collate(x.Zone, SearchCollation).Contains(term) ||
                codes.Contains(x.Code));
        }
        if (!string.IsNullOrEmpty(query.Severity))
        {
            var codes = MessageCatalog.CodesWithSeverity(query.Severity);
            messages = messages.Where(x => codes.Contains(x.Code));
        }
        if (!string.IsNullOrEmpty(query.DeviceId)) messages = messages.Where(x => x.DeviceId == query.DeviceId);
        if (query.Pending) messages = messages.Where(x => x.ReviewedAt == null);

        var total = await messages.CountAsync(cancellationToken);
        var rows = await messages.OrderByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        return new PagedResult<MessageDto>(rows.Select(MessageDto.From).ToList(), total, page, pageSize);
    }

    public async Task<MessageDto> ReviewAsync(long id, Actor actor, CancellationToken cancellationToken)
    {
        MiningMessage message;
        var reviewed = false;
        using (await mutations.AcquireAsync(cancellationToken))
        {
            message = await db.Messages.FirstOrDefaultAsync(x => x.Id == id, cancellationToken) ?? throw DomainException.NotFound("Mensaje no encontrado.");
            var kind = MessageCatalog.Get(message.Code);
            if (kind.Severity != Severities.Critical) throw DomainException.Invalid("Solo las alertas críticas requieren revisión.");
            if (message.ReviewedAt is null)
            {
                var now = time.UtcNow();
                message.ReviewedAt = now;
                message.ReviewedBy = actor.Name;
                db.Audit(actor.Name, $"Marcó como revisada la alerta #{message.Id}: {kind.Text}.", now);
                await db.SaveChangesAsync(cancellationToken);
                reviewed = true;
            }
        }
        var dto = MessageDto.From(message);
        if (reviewed)
        {
            await hub.Clients.All.MessageReviewed(dto);
            await hub.Clients.All.SystemChanged(ChangeCategories.Messages);
        }
        return dto;
    }

    // Idempotent by (DeviceId, ClientMessageId): a retry returns the stored message.
    public async Task<(MiningMessage Message, bool Duplicate)> RecordFromDeviceAsync(MiningDevice device, DeviceFrame frame, DateTime now, CancellationToken cancellationToken)
    {
        if (!device.HasActiveMiner || device.User is null)
            throw new DeviceProtocolException("La manilla necesita un minero asignado.", DeviceErrorCodes.Unassigned);
        var kind = MessageCatalog.Find(frame.Code) ?? throw new DeviceProtocolException("Mensaje fuera del catálogo.");
        if (string.IsNullOrWhiteSpace(frame.ClientMessageId) || frame.ClientMessageId.Length > 80)
            throw new DeviceProtocolException("Identificador de mensaje inválido.");
        if (frame.SentAt is null || frame.SentAt.Value.UtcDateTime > now.AddMinutes(5))
            throw new DeviceProtocolException("Fecha de envío inválida.");
        var detail = NormalizeDetail(kind, frame.Detail);

        MiningMessage? message;
        bool duplicate;
        using (await mutations.AcquireAsync(cancellationToken))
        {
            message = await db.Messages.FirstOrDefaultAsync(x => x.DeviceId == device.Id && x.ClientMessageId == frame.ClientMessageId, cancellationToken);
            duplicate = message is not null;
            if (message is not null && message.Code != kind.Code)
                throw new DeviceProtocolException("El identificador ya pertenece a otro mensaje.");
            if (message is null)
            {
                message = new MiningMessage
                {
                    DeviceId = device.Id,
                    ClientMessageId = frame.ClientMessageId,
                    Code = kind.Code,
                    Detail = detail,
                    MinerName = device.User.Name,
                    DeviceName = device.Name,
                    Zone = device.Zone,
                    SentAt = Clock.Truncate(frame.SentAt.Value.UtcDateTime),
                    ReceivedAt = now,
                };
                db.Messages.Add(message);
            }
            device.LastSeenAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }
        if (!duplicate) await hub.Clients.All.MessageReceived(MessageDto.From(message));
        return (message, duplicate);
    }

    private static bool MatchesText(string text, string term) =>
        CultureInfo.InvariantCulture.CompareInfo.IndexOf(text, term, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace) >= 0;

    private static string? NormalizeDetail(MessageKind kind, string? detail)
    {
        if (detail is null) return null;
        var trimmed = detail.Trim();
        if (!kind.Automatic) throw new DeviceProtocolException("Solo las alarmas automáticas admiten detalle.");
        if (trimmed.Length is 0 or > MaxDetailLength || trimmed.Any(char.IsControl))
            throw new DeviceProtocolException("Detalle de alarma inválido.");
        return trimmed;
    }
}
