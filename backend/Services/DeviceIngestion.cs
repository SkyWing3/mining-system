using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MiningSystem.Data;
using MiningSystem.DTOs;
using MiningSystem.Models;

namespace MiningSystem.Services;

public sealed class DeviceProtocolException(string message, bool unauthorized = false) : Exception(message)
{
    public bool Unauthorized { get; } = unauthorized;
}

public sealed class DeviceIngestion(MiningDb db, MutationLock mutations, IHubContext<MiningHub> hub)
{
    public static string HashKey(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    public async Task<MiningDevice?> Authenticate(string key)
    {
        if (key.Length != 64) return null;
        var hash = HashKey(key);
        return await db.Devices.Include(x => x.User).FirstOrDefaultAsync(x => x.KeyHash == hash && x.Active);
    }

    public async Task<object> Process(string key, DeviceFrame frame)
    {
        await mutations.Gate.WaitAsync();
        try
        {
            var device = await Authenticate(key) ?? throw new DeviceProtocolException("Credencial inválida o manilla desactivada.", true);
            if (device.User is not null && !device.User.Active) throw new DeviceProtocolException("El minero está desactivado.", true);
            if (frame.Type is not ("heartbeat" or "telemetry" or "message")) throw new DeviceProtocolException("Tipo de evento no válido.");
            var wasOnline = device.LastSeenAt > DateTime.UtcNow.AddSeconds(-90);
            MiningMessage? message = null;
            Telemetry? reading = null;
            var duplicate = false;
            if (frame.Type == "message")
            {
                if (device.User is null || device.User.Role != "Miner") throw new DeviceProtocolException("La manilla necesita un minero asignado.");
                if (frame.Code is null || MessageCatalog.Find(frame.Code) is null) throw new DeviceProtocolException("Mensaje fuera del catálogo.");
                if (string.IsNullOrWhiteSpace(frame.ClientMessageId) || frame.ClientMessageId.Length > 80) throw new DeviceProtocolException("Identificador de mensaje inválido.");
                if (frame.SentAt is null || frame.SentAt.Value.ToUniversalTime() > DateTime.UtcNow.AddMinutes(5)) throw new DeviceProtocolException("Fecha de envío inválida.");
                message = await db.Messages.FirstOrDefaultAsync(x => x.DeviceId == device.Id && x.ClientMessageId == frame.ClientMessageId);
                duplicate = message is not null;
                if (duplicate && message!.Code != frame.Code) throw new DeviceProtocolException("El identificador ya pertenece a otro mensaje.");
                if (!duplicate)
                {
                    message = new MiningMessage
                    {
                        DeviceId = device.Id, ClientMessageId = frame.ClientMessageId, Code = frame.Code,
                        MinerName = device.User.Name, DeviceName = device.Name, Zone = device.Zone,
                        SentAt = frame.SentAt.Value.ToUniversalTime()
                    };
                    db.Messages.Add(message);
                }
            }
            else if (frame.Type == "telemetry")
            {
                if (frame.TemperatureC is null && frame.GasPpm is null && frame.BatteryPercent is null)
                    throw new DeviceProtocolException("La lectura no contiene mediciones.");
                ValidateReading(frame.TemperatureC, -50, 150, "temperatura");
                ValidateReading(frame.GasPpm, 0, 1_000_000, "gas");
                ValidateReading(frame.BatteryPercent, 0, 100, "batería");
                reading = new Telemetry { DeviceId = device.Id, TemperatureC = frame.TemperatureC, GasPpm = frame.GasPpm, BatteryPercent = frame.BatteryPercent };
                db.Readings.Add(reading);
            }
            device.LastSeenAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            if (message is not null && !duplicate) await hub.Clients.All.SendAsync("MessageReceived", Views.Message(message));
            if (reading is not null) await hub.Clients.All.SendAsync("TelemetryReceived", new { deviceId = device.Id, reading = new { reading.Id, reading.TemperatureC, reading.GasPpm, reading.BatteryPercent, reading.ReceivedAt } });
            if (!wasOnline) await hub.Clients.All.SendAsync("SystemChanged", "presence");
            return new { type = "ack", clientMessageId = frame.ClientMessageId, messageId = message?.Id, duplicate, serverTime = DateTime.UtcNow };
        }
        finally { mutations.Gate.Release(); }
    }

    private static void ValidateReading(double? value, double min, double max, string field)
    {
        if (value is not null && (!double.IsFinite(value.Value) || value < min || value > max)) throw new DeviceProtocolException($"Valor de {field} inválido.");
    }
}
