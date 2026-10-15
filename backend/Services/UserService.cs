using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

public sealed class UserService(
    MiningDb db,
    PasswordHasher<User> hasher,
    MutationLock mutations,
    LiveSessions sessions,
    IHubContext<MiningHub, IMiningClient> hub,
    TimeProvider time)
{
    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public static string NormalizeName(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length < 2) throw DomainException.Invalid("Escribe un nombre válido.");
        return trimmed;
    }

    public async Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken cancellationToken) =>
        (await db.Users.AsNoTracking().OrderBy(x => x.Name).ToListAsync(cancellationToken)).Select(UserDto.From).ToList();

    public async Task<UserDto> SaveAsync(string? id, UserRequest request, Actor actor, CancellationToken cancellationToken)
    {
        if (!Roles.IsValid(request.Role)) throw DomainException.Invalid("Nombre o rol inválido.");
        var name = NormalizeName(request.Name);
        if (id is null && string.IsNullOrEmpty(request.Password))
            throw DomainException.Invalid("La contraseña es obligatoria al crear un usuario (mínimo 10 caracteres).");

        using var _ = await mutations.AcquireAsync(cancellationToken);
        var email = NormalizeEmail(request.Email);
        if (await db.Users.AnyAsync(x => x.Email == email && x.Id != id, cancellationToken))
            throw DomainException.Conflict("Este correo ya está registrado.");
        var now = time.UtcNow();
        var user = id is null ? new User { CreatedAt = now } : await db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (user is null) throw DomainException.NotFound("Usuario no encontrado.");
        await EnsureInvariantsAsync(user, request, actor, cancellationToken);

        // Role, status, e-mail or password changes invalidate previous sessions; a new name does not.
        var securityChanged = id is null || user.Role != request.Role || user.Active != request.Active || user.Email != email
            || !string.IsNullOrEmpty(request.Password);
        user.Name = name;
        user.Email = email;
        user.Role = request.Role;
        user.Active = request.Active;
        if (!string.IsNullOrEmpty(request.Password)) user.PasswordHash = hasher.HashPassword(user, request.Password);
        if (securityChanged) user.SessionVersion = User.NewSessionVersion();
        if (id is null) db.Users.Add(user);
        db.Audit(actor.Name, $"{(id is null ? "Creó" : "Actualizó")} el usuario {user.Name}.", now);
        await db.SaveChangesAsync(cancellationToken);

        if (securityChanged) sessions.Revoke(user.Id);
        await hub.Clients.All.SystemChanged(ChangeCategories.Users);
        return UserDto.From(user);
    }

    private async Task EnsureInvariantsAsync(User user, UserRequest request, Actor actor, CancellationToken cancellationToken)
    {
        if (user.Id == actor.Id && !request.Active)
            throw DomainException.Invalid("No puedes desactivar tu propia cuenta.");
        var losesAdministration = user.Role == Roles.Admin && user.Active && (!request.Active || request.Role != Roles.Admin);
        if (losesAdministration && await db.Users.CountAsync(x => x.Role == Roles.Admin && x.Active, cancellationToken) <= 1)
            throw DomainException.Invalid("El sistema debe conservar al menos un administrador activo.");
        var stopsBeingActiveMiner = !request.Active || request.Role != Roles.Miner;
        if (stopsBeingActiveMiner && await db.Devices.AnyAsync(x => x.UserId == user.Id && x.Active, cancellationToken))
            throw DomainException.Invalid("Desasigna primero las manillas activas de este minero.");
    }
}
