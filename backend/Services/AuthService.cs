using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.DTOs;
using MiningSystem.Realtime;

namespace MiningSystem.Services;

public sealed class AuthService(MiningDb db, PasswordHasher<User> hasher, MutationLock mutations, LiveSessions sessions, TimeProvider time)
{
    // Verifying against a fixed hash keeps unknown e-mails as slow as wrong passwords.
    private static readonly Lazy<string> DummyHash = new(() => new PasswordHasher<User>().HashPassword(new User(), Guid.NewGuid().ToString()));

    public async Task<bool> IsSetupRequiredAsync(CancellationToken cancellationToken) => !await db.Users.AnyAsync(cancellationToken);

    public async Task<User> SetupAsync(SetupRequest request, CancellationToken cancellationToken)
    {
        using var _ = await mutations.AcquireAsync(cancellationToken);
        if (await db.Users.AnyAsync(cancellationToken)) throw DomainException.Conflict("La cuenta inicial ya fue creada.");
        var name = UserService.NormalizeName(request.Name);
        var now = time.UtcNow();
        var user = new User { Name = name, Email = UserService.NormalizeEmail(request.Email), Role = Roles.Admin, CreatedAt = now };
        user.PasswordHash = hasher.HashPassword(user, request.Password);
        db.Users.Add(user);
        db.Audit(user.Name, "Configuró el sistema y creó la cuenta de administración.", now);
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    public async Task<User> LoginAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        var email = UserService.NormalizeEmail(request.Email);
        var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email, cancellationToken);
        var valid = hasher.VerifyHashedPassword(user ?? new User(), user?.PasswordHash ?? DummyHash.Value, request.Password) != PasswordVerificationResult.Failed;
        if (user is null || !user.Active || !valid) throw DomainException.Unauthorized("Correo o contraseña incorrectos.");
        if (user.Role == Roles.Miner)
            throw DomainException.Forbidden("Las cuentas de mineros se utilizan en las manillas. El panel requiere un supervisor o administrador.");
        return user;
    }

    public async Task<User> GetAsync(string userId, CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
        ?? throw DomainException.Unauthorized("Tu sesión ha terminado. Inicia sesión nuevamente.");

    public async Task LogoutAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null) return;
        user.SessionVersion = User.NewSessionVersion();
        await db.SaveChangesAsync(cancellationToken);
        sessions.Revoke(user.Id);
    }

    public async Task<User> ChangePasswordAsync(string userId, PasswordRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw DomainException.Unauthorized("Tu sesión ha terminado. Inicia sesión nuevamente.");
        if (hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
            throw DomainException.Invalid("La contraseña actual es incorrecta.");
        user.PasswordHash = hasher.HashPassword(user, request.NewPassword);
        user.SessionVersion = User.NewSessionVersion();
        db.Audit(user.Name, "Cambió su contraseña.", time.UtcNow());
        await db.SaveChangesAsync(cancellationToken);
        sessions.Revoke(user.Id);
        return user;
    }
}
