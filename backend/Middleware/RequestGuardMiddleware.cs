using Microsoft.Extensions.Options;
using MiningSystem.Configuration;

namespace MiningSystem.Middleware;

// Origin allow-list for the API and hub, plus a custom header that blocks cross-site form posts
// carrying session cookies. Device uploads authenticate with X-Device-Key instead of cookies.
public sealed class RequestGuardMiddleware(RequestDelegate next, IOptions<MiningOptions> options)
{
    public const string ClientHeader = "X-Mining-Client";
    public const string WebClient = "web";

    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        var isApi = request.Path.StartsWithSegments("/api");
        var isDeviceApi = request.Path.StartsWithSegments("/api/device");
        var origin = request.Headers.Origin.ToString();
        if ((isApi || request.Path.StartsWithSegments("/hubs")) && origin.Length > 0 && !IsAllowedOrigin(request, origin))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
        var mutation = !HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method) && !HttpMethods.IsOptions(request.Method);
        if (isApi && !isDeviceApi && mutation && request.Headers[ClientHeader] != WebClient)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "Solicitud no autorizada." });
            return;
        }

        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers["Referrer-Policy"] = "same-origin";
        if (isApi) context.Response.Headers.CacheControl = "no-store";
        await next(context);
    }

    private bool IsAllowedOrigin(HttpRequest request, string origin) =>
        origin == $"{request.Scheme}://{request.Host}" ||
        options.Value.EffectiveOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
}
