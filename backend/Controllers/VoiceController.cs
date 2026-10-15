using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/voice"), Authorize(Roles = Roles.Operators)]
public sealed class VoiceController(VoiceService voice) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<VoiceMessageDto>> List([FromQuery] PageQuery query, CancellationToken cancellationToken) =>
        voice.ListAsync(query, cancellationToken);

    [HttpGet("{id:long}/audio")]
    public async Task<IActionResult> Audio(long id, CancellationToken cancellationToken)
    {
        var audio = await voice.GetAudioAsync(id, cancellationToken);
        Response.Headers.CacheControl = "private, no-store";
        return PhysicalFile(audio.Path, "audio/wav", audio.FileName, enableRangeProcessing: true);
    }

    [HttpPost("{id:long}/review")]
    public Task<VoiceMessageDto> Review(long id, CancellationToken cancellationToken) =>
        voice.ReviewAsync(id, User.ToActor(), cancellationToken);
}
