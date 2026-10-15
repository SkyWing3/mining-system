using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace MiningSystem.Data;

// Used only by `dotnet ef migrations`; generating a migration never opens this connection.
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<MiningDb>
{
    public MiningDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<MiningDb>().UseMySQL("Server=localhost;Database=mining_design;User ID=design").Options);
}
