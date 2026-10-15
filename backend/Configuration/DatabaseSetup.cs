using System.Text.Json;
using MySql.Data.MySqlClient;

namespace MiningSystem.Configuration;

public static class DatabaseSetup
{
    // Environment/user secrets first, then the private data/mysql.json used by local development.
    public static string ResolveConnectionString(MiningOptions options, MiningPaths paths)
    {
        var connectionString = options.ConnectionString;
        if (string.IsNullOrWhiteSpace(connectionString) && File.Exists(paths.LocalDatabaseSettings))
        {
            using var settings = JsonDocument.Parse(File.ReadAllText(paths.LocalDatabaseSettings));
            connectionString = settings.RootElement.GetProperty("connectionString").GetString();
        }
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("Configura Mining__ConnectionString con el servidor, base y usuario de MySQL. Consulta docs/mysql.md.");

        var builder = new MySqlConnectionStringBuilder(connectionString);
        if (!string.IsNullOrWhiteSpace(options.PasswordFile))
            builder.Password = File.ReadAllText(options.PasswordFile).TrimEnd('\r', '\n');
        return builder.ConnectionString;
    }
}
