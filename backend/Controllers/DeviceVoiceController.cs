using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Extensions;
using MiningSystem.Realtime;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

// Upload from the device, authenticated by X-Device-Key (no cookies, so no CSRF header).
[ApiController, Route("api/device/voice"), AllowAnonymous]
public sealed class DeviceVoiceController(DeviceAuthenticator authenticator, VoiceService voice) : ControllerBase
{
    public const long MaxRequestBytes = 16 * 1024 * 1024;

    [HttpPost, RequestSizeLimit(MaxRequestBytes), EnableRateLimiting(RateLimitPolicies.DeviceVoice)]
    public async Task<IActionResult> Upload(
        [FromHeader(Name = "X-Device-Key")] string? key,
        [FromHeader(Name = "X-Client-Message-Id")] string? clientMessageId,
        [FromHeader(Name = "X-Recorded-At")] DateTimeOffset? recordedAt,
        CancellationToken cancellationToken)
    {
        var device = await authenticator.AuthenticateAsync(key, cancellationToken)
            ?? throw DomainException.Unauthorized("Credencial inválida o manilla desactivada.");
        if (string.IsNullOrEmpty(clientMessageId) || recordedAt is null)
            throw DomainException.Invalid("Faltan X-Client-Message-Id o X-Recorded-At.");
        if (Request.ContentType?.StartsWith("audio/wav", StringComparison.OrdinalIgnoreCase) != true &&
            Request.ContentType?.StartsWith("audio/x-wav", StringComparison.OrdinalIgnoreCase) != true)
            return StatusCode(StatusCodes.Status415UnsupportedMediaType, new { message = "El audio debe enviarse como audio/wav." });

        var result = await voice.ReceiveAsync(device, new VoiceUpload(clientMessageId, recordedAt.Value, Request.Body), cancellationToken);
        return result.Duplicate ? Ok(new { voice = result.Voice, duplicate = true }) : StatusCode(StatusCodes.Status201Created, new { voice = result.Voice, duplicate = false });
    }
}
