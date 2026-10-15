using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/users"), Authorize(Roles = Roles.Admin)]
public sealed class UsersController(UserService users) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<UserDto>> List(CancellationToken cancellationToken) => users.ListAsync(cancellationToken);

    [HttpPost]
    public Task<UserDto> Create(UserRequest request, CancellationToken cancellationToken) =>
        users.SaveAsync(null, request, User.ToActor(), cancellationToken);

    [HttpPut("{id}")]
    public Task<UserDto> Update(string id, UserRequest request, CancellationToken cancellationToken) =>
        users.SaveAsync(id, request, User.ToActor(), cancellationToken);
}
