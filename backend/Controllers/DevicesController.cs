using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Services;

namespace MiningSystem.Controllers;

[ApiController, Route("api/devices"), Authorize(Roles = Roles.Operators)]
public sealed class DevicesController(DeviceService devices, TelemetryService telemetry) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<DeviceDto>> List(CancellationToken cancellationToken) => devices.ListAsync(cancellationToken);

    [HttpGet("miners")]
    public Task<IReadOnlyList<UserDto>> Miners(CancellationToken cancellationToken) => devices.ListMinersAsync(cancellationToken);

    [HttpPost]
    public Task<DeviceSavedDto> Create(DeviceRequest request, CancellationToken cancellationToken) =>
        devices.SaveAsync(null, request, User.ToActor(), cancellationToken);

    [HttpPut("{id}")]
    public Task<DeviceSavedDto> Update(string id, DeviceRequest request, CancellationToken cancellationToken) =>
        devices.SaveAsync(id, request, User.ToActor(), cancellationToken);

    [HttpPost("{id}/rotate-key")]
    public Task<ApiKeyDto> RotateKey(string id, CancellationToken cancellationToken) =>
        devices.RotateKeyAsync(id, User.ToActor(), cancellationToken);

    // Most recent first; `since` narrows the window used to seed live charts.
    [HttpGet("{id}/telemetry")]
    public Task<IReadOnlyList<ReadingDto>> Telemetry(string id, [FromQuery] TelemetryQuery query, CancellationToken cancellationToken) =>
        telemetry.HistoryAsync(id, query, cancellationToken);
}
