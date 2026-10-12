using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Models;
using MiningSystem.Services;

var builder = WebApplication.CreateBuilder(args);
var dataDirectory = Path.GetFullPath(builder.Configuration["Mining:DataDirectory"] ?? Path.Combine(builder.Environment.ContentRootPath, "../data"));
Directory.CreateDirectory(dataDirectory);
builder.Services.AddDbContext<MiningDb>(options => options.UseSqlite($"Data Source={Path.Combine(dataDirectory, "mining.db")};Foreign Keys=True"));
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDirectory, "keys"))).SetApplicationName("MiningSystem");
builder.Services.AddSingleton<MutationLock>();
builder.Services.AddSingleton<LiveSessions>();
builder.Services.AddScoped<PasswordHasher<User>>();
builder.Services.AddScoped<DeviceIngestion>();
builder.Services.AddHostedService<PresenceWorker>();
builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.Configure<ForwardedHeadersOptions>(options => options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 8192);
var origins = builder.Configuration.GetSection("Mining:AllowedOrigins").Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "mining.session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    options.Events.OnValidatePrincipal = async context =>
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<MiningDb>();
        var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (user is null || !user.Active || user.SessionVersion != context.Principal?.FindFirstValue("version"))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync();
        }
    };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MiningDb>();
    await db.Database.EnsureCreatedAsync();
    await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
}
app.UseExceptionHandler(error => error.Run(async context =>
{
    context.Response.StatusCode = 500;
    await context.Response.WriteAsJsonAsync(new { message = "No se pudo completar la operación. Intenta nuevamente." });
}));
app.UseForwardedHeaders();
app.UseCors();
app.Use(async (context, next) =>
{
    var request = context.Request;
    var origin = request.Headers.Origin.ToString();
    var sameOrigin = origin == $"{request.Scheme}://{request.Host}";
    if ((request.Path.StartsWithSegments("/hubs") || request.Path.StartsWithSegments("/api")) &&
        origin.Length > 0 && !sameOrigin && !origins.Contains(origin, StringComparer.OrdinalIgnoreCase))
    { context.Response.StatusCode = 403; return; }
    // This custom header prevents cross-site form submissions with session cookies.
    if (request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(request.Method) && !HttpMethods.IsOptions(request.Method) && request.Headers["X-Mining-Client"] != "web")
    { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { message = "Solicitud no autorizada." }); return; }
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    if (request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "no-store";
    await next();
});
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "Mining System" }));
app.MapControllers();
app.MapHub<MiningHub>("/hubs/mining", options => options.CloseOnAuthenticationExpiration = true);
app.MapGet("/ws/device", DeviceSocket.Handle);
app.Map("/api/{**path}", () => Results.NotFound(new { message = "Ruta no encontrada." }));
if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}
app.Run();

public partial class Program;
