using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

public sealed record VoiceUpload(string ClientMessageId, DateTimeOffset RecordedAt, Stream Body);

public sealed record VoiceUploadResult(VoiceMessageDto Voice, bool Duplicate);

public sealed record VoiceAudio(string Path, string FileName);

public sealed partial class VoiceService(
    MiningDb db,
    MiningPaths paths,
    IOptions<MiningOptions> options,
    IHubContext<MiningHub, IMiningClient> hub,
    MutationLock mutations,
    TimeProvider time)
{
    public const double MinSeconds = 0.3;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,80}$")]
    private static partial Regex ClientIdPattern();

    public async Task<VoiceUploadResult> ReceiveAsync(MiningDevice device, VoiceUpload upload, CancellationToken cancellationToken)
    {
        if (!device.HasActiveMiner || device.User is null) throw DomainException.Conflict("La manilla necesita un minero asignado.");
        if (!ClientIdPattern().IsMatch(upload.ClientMessageId)) throw DomainException.Invalid("Identificador de mensaje inválido.");
        var now = time.UtcNow();
        if (upload.RecordedAt.UtcDateTime > now.AddMinutes(5)) throw DomainException.Invalid("Fecha de grabación inválida.");

        var existing = await db.VoiceMessages.AsNoTracking()
            .FirstOrDefaultAsync(x => x.DeviceId == device.Id && x.ClientMessageId == upload.ClientMessageId, cancellationToken);
        if (existing is not null) return new VoiceUploadResult(VoiceMessageDto.From(existing), true);

        var limits = options.Value.Voice;
        var audio = await ReadLimitedAsync(upload.Body, limits.MaxBytes, cancellationToken);
        var info = WavInspector.Inspect(audio);
        if (info.DurationMs < MinSeconds * 1000 || info.DurationMs > limits.MaxSeconds * 1000)
            throw DomainException.Invalid($"La grabación debe durar entre {MinSeconds} y {limits.MaxSeconds} segundos.");

        var relativePath = Path.Combine(now.ToString("yyyy"), now.ToString("MM"), $"{Guid.NewGuid():N}.wav");
        var fullPath = Path.Combine(paths.VoiceDirectory, relativePath);
        await WriteAtomicallyAsync(fullPath, audio, cancellationToken);

        var voice = new VoiceMessage
        {
            DeviceId = device.Id,
            ClientMessageId = upload.ClientMessageId,
            MinerName = device.User.Name,
            DeviceName = device.Name,
            Zone = device.Zone,
            RecordedAt = Clock.Truncate(upload.RecordedAt.UtcDateTime),
            ReceivedAt = now,
            DurationMs = info.DurationMs,
            SampleRate = info.SampleRate,
            SizeBytes = audio.Length,
            StoragePath = relativePath,
        };
        try
        {
            using (await mutations.AcquireAsync(cancellationToken))
            {
                device.LastSeenAt = now;
                db.VoiceMessages.Add(voice);
                await db.SaveChangesAsync(cancellationToken);
            }
        }
        catch (DbUpdateException)
        {
            // A concurrent retry stored the same recording first.
            File.Delete(fullPath);
            db.ChangeTracker.Clear();
            var stored = await db.VoiceMessages.AsNoTracking()
                .FirstOrDefaultAsync(x => x.DeviceId == device.Id && x.ClientMessageId == upload.ClientMessageId, cancellationToken);
            if (stored is null) throw;
            return new VoiceUploadResult(VoiceMessageDto.From(stored), true);
        }

        var dto = VoiceMessageDto.From(voice);
        await hub.Clients.All.VoiceMessageReceived(dto);
        return new VoiceUploadResult(dto, false);
    }

    public async Task<PagedResult<VoiceMessageDto>> ListAsync(PageQuery query, CancellationToken cancellationToken)
    {
        var (page, pageSize) = Paging.Normalize(query.Page, query.PageSize);
        var voices = db.VoiceMessages.AsNoTracking().AsQueryable();
        if (!string.IsNullOrEmpty(query.DeviceId)) voices = voices.Where(x => x.DeviceId == query.DeviceId);
        if (query.Pending) voices = voices.Where(x => x.ReviewedAt == null);
        var total = await voices.CountAsync(cancellationToken);
        var rows = await voices.OrderByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        return new PagedResult<VoiceMessageDto>(rows.Select(VoiceMessageDto.From).ToList(), total, page, pageSize);
    }

    public async Task<VoiceAudio> GetAudioAsync(long id, CancellationToken cancellationToken)
    {
        var voice = await db.VoiceMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw DomainException.NotFound("Mensaje de voz no encontrado.");
        var root = Path.GetFullPath(paths.VoiceDirectory);
        var fullPath = Path.GetFullPath(Path.Combine(root, voice.StoragePath));
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(fullPath))
            throw DomainException.NotFound("El audio ya no está disponible.");
        return new VoiceAudio(fullPath, $"voz-{voice.Id}.wav");
    }

    public async Task<VoiceMessageDto> ReviewAsync(long id, Actor actor, CancellationToken cancellationToken)
    {
        VoiceMessage voice;
        var reviewed = false;
        using (await mutations.AcquireAsync(cancellationToken))
        {
            voice = await db.VoiceMessages.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                ?? throw DomainException.NotFound("Mensaje de voz no encontrado.");
            if (voice.ReviewedAt is null)
            {
                var now = time.UtcNow();
                voice.ReviewedAt = now;
                voice.ReviewedBy = actor.Name;
                db.Audit(actor.Name, $"Escuchó el mensaje de voz #{voice.Id} de {voice.MinerName}.", now);
                await db.SaveChangesAsync(cancellationToken);
                reviewed = true;
            }
        }
        var dto = VoiceMessageDto.From(voice);
        if (reviewed)
        {
            await hub.Clients.All.VoiceMessageReviewed(dto);
            await hub.Clients.All.SystemChanged(ChangeCategories.Voice);
        }
        return dto;
    }

    private static async Task<byte[]> ReadLimitedAsync(Stream body, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > maxBytes) throw DomainException.TooLarge("La grabación supera el tamaño permitido.");
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private static async Task WriteAtomicallyAsync(string path, byte[] content, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        try
        {
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await output.WriteAsync(content, cancellationToken);
                await output.FlushAsync(cancellationToken);
            }
            File.Move(temporary, path);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
