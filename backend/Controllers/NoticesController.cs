using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/notices"), Authorize(Roles = Roles.Operators)]
public sealed class NoticesController(NoticeService notices) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<NoticeDto>> List([FromQuery] PageQuery query, CancellationToken cancellationToken) =>
        notices.ListAsync(query, cancellationToken);

    [HttpGet("catalog")]
    public IReadOnlyList<NoticeKind> Catalog() => NoticeCatalog.All;

    [HttpPost]
    public Task<IReadOnlyList<NoticeDto>> Create(NoticeRequest request, CancellationToken cancellationToken) =>
        notices.CreateAsync(request, User.ToActor(), cancellationToken);
}
