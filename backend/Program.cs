using MiningSystem.Extensions;

var builder = WebApplication.CreateBuilder(args);
builder.AddMining();

var app = builder.Build();
if (await app.PrepareDatabaseAsync()) return;
app.UseMining();
app.Run();

public partial class Program;
