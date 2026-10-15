using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.Middleware;
using MiningSystem.Realtime;

namespace MiningSystem.Extensions;

public static class ApplicationBuilderExtensions
{
    // Applies migrations and runs one-off commands. Returns true when the process should exit.
    public static async Task<bool> PrepareDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiningDb>();
        if (app.Configuration["export-schema"] is { } schemaPath)
        {
            await File.WriteAllTextAsync(schemaPath, db.Database.GenerateCreateScript());
            return true;
        }
        await db.Database.MigrateAsync();
        if (app.Configuration["import-legacy"] is { } importPath)
        {
            await LegacyImport.Run(db, importPath);
            return true;
        }
        return false;
    }

    public static WebApplication UseMining(this WebApplication app)
    {
        app.UseExceptionHandler();
        app.UseForwardedHeaders();
        app.UseCors();
        app.UseMiddleware<RequestGuardMiddleware>();
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        if (app.Environment.IsDevelopment()) app.MapOpenApi();
        app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "Mining System" }));
        app.MapControllers();
        app.MapHub<MiningHub>("/hubs/mining", hub => hub.CloseOnAuthenticationExpiration = true);
        app.MapGet("/ws/device", (HttpContext context, DeviceSocketHandler handler) => handler.HandleAsync(context));
        app.Map("/api/{**path}", () => Results.NotFound(new { message = "Ruta no encontrada." }));

        // The compiled React app, when it is served by the same process (scripts/serve.sh).
        if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
        {
            app.UseDefaultFiles();
            app.UseStaticFiles();
            app.MapFallbackToFile("index.html");
        }
        return app;
    }
}
