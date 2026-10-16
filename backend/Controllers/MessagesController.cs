using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api"), Authorize(Roles = Roles.Operators)]
public sealed class MessagesController(MessageService messages, OverviewService overview) : ControllerBase
{
    [HttpGet("overview")]
    public Task<OverviewDto> Overview(CancellationToken cancellationToken) => overview.GetAsync(cancellationToken);

    [HttpGet("messages")]
    public Task<PagedResult<MessageDto>> List([FromQuery] MessageQuery query, CancellationToken cancellationToken) =>
        messages.ListAsync(query, cancellationToken);

    // Internal review of a critical alert; nothing is sent back to the device.
    [HttpPost("messages/{id:long}/review")]
    public Task<MessageDto> Review(long id, CancellationToken cancellationToken) =>
        messages.ReviewAsync(id, User.ToActor(), cancellationToken);

    [HttpGet("events")]
    public Task<IReadOnlyList<AuditEventDto>> Events(CancellationToken cancellationToken) => overview.RecentEventsAsync(cancellationToken);
}
