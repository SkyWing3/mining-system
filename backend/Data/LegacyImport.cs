using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Domain;

namespace MiningSystem.Data;

// One-time import of an offline JSON export. No legacy database provider is loaded.
public static class LegacyImport
{
    private sealed record Export(User[] Users, MiningDevice[] Devices, MiningMessage[] Messages, Reading[] Readings, AuditEvent[] Events);

    public static async Task Run(MiningDb db, string path)
    {
        if (await db.Users.AnyAsync() || await db.Devices.AnyAsync() || await db.Messages.AnyAsync() || await db.Readings.AnyAsync() || await db.Events.AnyAsync())
            throw new InvalidOperationException("La importación requiere una base MySQL vacía. No se sobrescribió ningún dato.");
        await using var input = File.OpenRead(path);
        var data = await JsonSerializer.DeserializeAsync<Export>(input) ?? throw new InvalidDataException("Exportación vacía.");
        await using var transaction = await db.Database.BeginTransactionAsync();
        db.Users.AddRange(data.Users);
        await db.SaveChangesAsync();
        db.Devices.AddRange(data.Devices);
        await db.SaveChangesAsync();
        db.Messages.AddRange(data.Messages);
        db.Readings.AddRange(data.Readings);
        db.Events.AddRange(data.Events);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        Console.WriteLine($"Importación confirmada: {data.Users.Length} usuarios, {data.Devices.Length} manillas, {data.Messages.Length} mensajes, {data.Readings.Length} lecturas, {data.Events.Length} eventos.");
    }
}
