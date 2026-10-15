namespace MiningSystem.Domain;

public enum DomainErrorKind
{
    Invalid,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    TooLarge,
}

// Business rule violations; the API translates them to HTTP status codes with { message }.
public sealed class DomainException(DomainErrorKind kind, string message) : Exception(message)
{
    public DomainErrorKind Kind { get; } = kind;

    public static DomainException Invalid(string message) => new(DomainErrorKind.Invalid, message);
    public static DomainException Unauthorized(string message) => new(DomainErrorKind.Unauthorized, message);
    public static DomainException Forbidden(string message) => new(DomainErrorKind.Forbidden, message);
    public static DomainException NotFound(string message) => new(DomainErrorKind.NotFound, message);
    public static DomainException Conflict(string message) => new(DomainErrorKind.Conflict, message);
    public static DomainException TooLarge(string message) => new(DomainErrorKind.TooLarge, message);
}
