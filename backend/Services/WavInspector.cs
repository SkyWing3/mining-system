using System.Buffers.Binary;
using System.Text;
using MiningSystem.Domain;

namespace MiningSystem.Services;

public sealed record WavInfo(int SampleRate, int Channels, int BitsPerSample, int DataOffset, int DataLength)
{
    public int DurationMs => (int)(DataLength * 1000L / (SampleRate * Channels * (BitsPerSample / 8)));
}

// Minimal RIFF/WAVE parser: accepts only uncompressed PCM, mono, 16-bit, as recorded by the device.
public static class WavInspector
{
    public const int MinSampleRate = 8000;
    public const int MaxSampleRate = 48000;

    public static WavInfo Inspect(ReadOnlySpan<byte> data)
    {
        if (data.Length < 44 || !Is(data, 0, "RIFF") || !Is(data, 8, "WAVE"))
            throw DomainException.Invalid("El audio debe ser un archivo WAV.");

        (int Rate, int Channels, int Bits)? format = null;
        var position = 12;
        while (position + 8 <= data.Length)
        {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(data[(position + 4)..]);
            var body = position + 8;
            if (size > (uint)(data.Length - body))
                throw DomainException.Invalid("El archivo WAV está incompleto.");
            if (Is(data, position, "fmt "))
            {
                if (size < 16) throw DomainException.Invalid("Formato WAV inválido.");
                var audioFormat = BinaryPrimitives.ReadUInt16LittleEndian(data[body..]);
                var channels = BinaryPrimitives.ReadUInt16LittleEndian(data[(body + 2)..]);
                var rate = BinaryPrimitives.ReadInt32LittleEndian(data[(body + 4)..]);
                var bits = BinaryPrimitives.ReadUInt16LittleEndian(data[(body + 14)..]);
                if (audioFormat != 1 || channels != 1 || bits != 16 || rate is < MinSampleRate or > MaxSampleRate)
                    throw DomainException.Invalid("El audio debe ser PCM mono de 16 bits entre 8 y 48 kHz.");
                format = (rate, channels, bits);
            }
            else if (Is(data, position, "data"))
            {
                if (format is null) throw DomainException.Invalid("Formato WAV inválido.");
                if (size == 0 || size % 2 != 0) throw DomainException.Invalid("El audio no contiene muestras válidas.");
                return new WavInfo(format.Value.Rate, format.Value.Channels, format.Value.Bits, body, (int)size);
            }
            // Chunks are padded to an even size.
            position = body + (int)size + (int)(size & 1);
        }
        throw DomainException.Invalid("El archivo WAV no contiene audio.");
    }

    private static bool Is(ReadOnlySpan<byte> data, int offset, string tag) =>
        data.Slice(offset, 4).SequenceEqual(Encoding.ASCII.GetBytes(tag));
}
