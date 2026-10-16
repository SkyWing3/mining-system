using System.Buffers.Binary;
using System.Text;
using MiningSystem.Domain;
using MiningSystem.Services;

namespace MiningSystem.UnitTests;

public sealed class WavInspectorTests
{
    internal static byte[] Wav(int sampleRate = 16000, short channels = 1, short bits = 16, int samples = 16000, short format = 1, bool extraChunk = false)
    {
        var dataBytes = samples * channels * (bits / 8);
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.ASCII);
        writer.Write("RIFF"u8);
        writer.Write(0);
        writer.Write("WAVE"u8);
        if (extraChunk)
        {
            writer.Write("LIST"u8);
            writer.Write(3);
            writer.Write(new byte[] { 1, 2, 3, 0 });
        }
        writer.Write("fmt "u8);
        writer.Write(16);
        writer.Write(format);
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * channels * bits / 8);
        writer.Write((short)(channels * bits / 8));
        writer.Write(bits);
        writer.Write("data"u8);
        writer.Write(dataBytes);
        writer.Write(new byte[dataBytes]);
        var bytes = stream.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(4), bytes.Length - 8);
        return bytes;
    }

    [Fact]
    public void AcceptsMonoPcmAndComputesDuration()
    {
        var info = WavInspector.Inspect(Wav(samples: 24000));
        Assert.Equal(16000, info.SampleRate);
        Assert.Equal(1500, info.DurationMs);
        Assert.Equal(44, info.DataOffset);
    }

    [Fact]
    public void SkipsUnknownChunksWithPadding()
    {
        var info = WavInspector.Inspect(Wav(extraChunk: true));
        Assert.Equal(1000, info.DurationMs);
    }

    [Theory]
    [InlineData(16000, 2, 16, 1)]
    [InlineData(16000, 1, 8, 1)]
    [InlineData(16000, 1, 16, 3)]
    [InlineData(4000, 1, 16, 1)]
    [InlineData(96000, 1, 16, 1)]
    public void RejectsUnsupportedFormats(int rate, short channels, short bits, short format)
    {
        var error = Assert.Throws<DomainException>(() => WavInspector.Inspect(Wav(rate, channels, bits, 8000, format)));
        Assert.Equal(DomainErrorKind.Invalid, error.Kind);
    }

    [Fact]
    public void RejectsTruncatedAndForeignFiles()
    {
        var truncated = Wav()[..1000];
        Assert.Throws<DomainException>(() => WavInspector.Inspect(truncated));
        Assert.Throws<DomainException>(() => WavInspector.Inspect(Encoding.ASCII.GetBytes(new string('x', 64))));
        Assert.Throws<DomainException>(() => WavInspector.Inspect(Wav(samples: 0)));
    }
}
