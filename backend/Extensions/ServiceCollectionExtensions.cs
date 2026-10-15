using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiningSystem.Configuration;
using MiningSystem.Data;
using MiningSystem.Domain;
using MiningSystem.Middleware;
using MiningSystem.Realtime;
using MiningSystem.Services;
using MiningSystem.Workers;

namespace MiningSystem.Extensions;

public static class RateLimitPolicies
{
    public const string Login = "login";
    public const string DeviceVoice = "device-voice";
}

public static class ServiceCollectionExtensions
{
    public static WebApplicationBuilder AddMining(this WebApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection(MiningOptions.SectionName);
        builder.Services.AddOptions<MiningOptions>().Bind(section).ValidateDataAnnotations().ValidateOnStart();
        var options = section.Get<MiningOptions>() ?? new MiningOptions();
        var paths = new MiningPaths(Path.GetFullPath(options.DataDirectory ?? Path.Combine(builder.Environment.ContentRootPath, "../data")));
        Directory.CreateDirectory(paths.DataDirectory);
        builder.Services.AddSingleton(paths);
        builder.Services.AddSingleton(TimeProvider.System);

        builder.Services.AddDbContext<MiningDb>(db => db.UseMySQL(DatabaseSetup.ResolveConnectionString(options, paths)));
        builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(paths.KeysDirectory)).SetApplicationName("MiningSystem");

        builder.Services
            .AddMiningSecurity(options)
            .AddMiningDomain();
        builder.Services.AddControllers();
        builder.Services.AddOpenApi();
        builder.Services.AddSignalR(hub => hub.MaximumReceiveMessageSize = 8192);
        builder.Services.AddExceptionHandler<ApiExceptionHandler>();
        builder.Services.AddProblemDetails();
        builder.Services.Configure<ForwardedHeadersOptions>(forwarded =>
        {
            forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            foreach (var network in options.KnownProxyNetworks)
                forwarded.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        });
        return builder;
    }

    private static IServiceCollection AddMiningDomain(this IServiceCollection services)
    {
        services.AddSingleton<MutationLock>();
        services.AddSingleton<LiveSessions>();
        services.AddSingleton<DeviceConnections>();
        services.AddSingleton<DevicePresence>();
        services.AddSingleton<LatestReadingCache>();
        services.AddSingleton<TelemetryPersistencePolicy>();
        services.AddSingleton<DeviceSocketHandler>();
        services.AddScoped<PasswordHasher<User>>();
        services.AddScoped<AuthService>();
        services.AddScoped<UserService>();
        services.AddScoped<DeviceService>();
        services.AddScoped<TelemetryService>();
        services.AddScoped<MessageService>();
        services.AddScoped<OverviewService>();
        services.AddScoped<VoiceService>();
        services.AddScoped<NoticeService>();
        services.AddScoped<DeviceAuthenticator>();
        services.AddScoped<DeviceFrameProcessor>();
        services.AddHostedService<PresenceWorker>();
        services.AddHostedService<MaintenanceWorker>();
        return services;
    }

    private static IServiceCollection AddMiningSecurity(this IServiceCollection services, MiningOptions options)
    {
        services.AddCors(cors => cors.AddDefaultPolicy(policy =>
            policy.WithOrigins(options.EffectiveOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(cookie =>
        {
            cookie.Cookie.Name = "mining.session";
            cookie.Cookie.HttpOnly = true;
            cookie.Cookie.SameSite = SameSiteMode.Strict;
            cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            cookie.ExpireTimeSpan = SessionCookies.Lifetime;
            cookie.SlidingExpiration = false;
            cookie.Events.OnRedirectToLogin = context => { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
            cookie.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
            cookie.Events.OnValidatePrincipal = ValidateSessionAsync;
        });
        services.AddAuthorization();
        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.AddPolicy(RateLimitPolicies.Login, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = options.LoginAttemptsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            limiter.AddPolicy(RateLimitPolicies.DeviceVoice, context => RateLimitPartition.GetFixedWindowLimiter(
                DeviceKeys.Hash(context.Request.Headers["X-Device-Key"].ToString()),
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = context.RequestServices.GetRequiredService<IOptions<MiningOptions>>().Value.Voice.UploadsPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));
        });
        return services;
    }

    // Rejects cookies whose account was disabled or whose session version changed.
    private static async Task ValidateSessionAsync(CookieValidatePrincipalContext context)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<MiningDb>();
        var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = id is null ? null : await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (user is null || !user.Active || user.SessionVersion != context.Principal?.FindFirstValue(SessionClaims.Version))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync();
        }
    }
}
