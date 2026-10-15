using Microsoft.AspNetCore.Diagnostics;
using MiningSystem.Domain;

namespace MiningSystem.Middleware;

// Business errors become { message } with their status; anything else is logged and hidden.
public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var (status, message) = exception switch
        {
            DomainException domain => (StatusFor(domain.Kind), domain.Message),
            BadHttpRequestException badRequest => (badRequest.StatusCode, badRequest.StatusCode == StatusCodes.Status413PayloadTooLarge
                ? "La solicitud supera el tamaño permitido."
                : "Solicitud inválida."),
            _ => (StatusCodes.Status500InternalServerError, "No se pudo completar la operación. Intenta nuevamente."),
        };
        if (status >= 500) logger.LogError(exception, "Unhandled error on {Path}", context.Request.Path);
        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(new { message }, cancellationToken);
        return true;
    }

    private static int StatusFor(DomainErrorKind kind) => kind switch
    {
        DomainErrorKind.Invalid => StatusCodes.Status400BadRequest,
        DomainErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
        DomainErrorKind.Forbidden => StatusCodes.Status403Forbidden,
        DomainErrorKind.NotFound => StatusCodes.Status404NotFound,
        DomainErrorKind.Conflict => StatusCodes.Status409Conflict,
        DomainErrorKind.TooLarge => StatusCodes.Status413PayloadTooLarge,
        _ => StatusCodes.Status400BadRequest,
    };
}
