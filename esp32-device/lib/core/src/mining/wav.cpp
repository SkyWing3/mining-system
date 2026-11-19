#include "mining/wav.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace mining {

namespace {
void put16(uint8_t* at, uint16_t value) {
    at[0] = static_cast<uint8_t>(value);
    at[1] = static_cast<uint8_t>(value >> 8);
}

void put32(uint8_t* at, uint32_t value) {
    for (int index = 0; index < 4; ++index) at[index] = static_cast<uint8_t>(value >> (8 * index));
}

// One-pole DC blocker: y[n] = x[n] - x[n-1] + R * y[n-1].
constexpr float kDcPole = 0.995f;
// 24-bit samples to 16 bits would be >> 8; >> 5 keeps 3 extra bits (x8, +18 dB).
constexpr float kPreGain = 1.0f / 32.0f;
}  // namespace

void writeWavHeader(uint8_t* header, uint32_t sampleRate, uint32_t dataBytes) {
    std::memcpy(header, "RIFF", 4);
    put32(header + 4, 36 + dataBytes);
    std::memcpy(header + 8, "WAVEfmt ", 8);
    put32(header + 16, 16);           // fmt chunk size
    put16(header + 20, 1);            // PCM
    put16(header + 22, 1);            // mono
    put32(header + 24, sampleRate);
    put32(header + 28, sampleRate * 2);  // byte rate
    put16(header + 32, 2);            // block align
    put16(header + 34, 16);           // bits per sample
    std::memcpy(header + 36, "data", 4);
    put32(header + 40, dataBytes);
}

double normalizationGain(int peak, double targetPeak, double maxGain) {
    if (peak <= 0) return 1.0;
    double gain = std::min(maxGain, targetPeak * kFullScale / peak);
    return gain > 1.0 ? gain : 1.0;
}

int16_t scaleSample(int16_t sample, double gain) {
    long value = std::lround(sample * gain);
    return static_cast<int16_t>(std::max<long>(-kFullScale, std::min<long>(kFullScale, value)));
}

int16_t MicConverter::convert(int32_t raw) {
    float input = static_cast<float>(raw >> 8);
    float output = input - previousInput_ + kDcPole * previousOutput_;
    previousInput_ = input;
    previousOutput_ = output;
    float scaled = output * kPreGain;
    if (scaled > kFullScale) return kFullScale;
    if (scaled < -kFullScale) return -kFullScale;
    return static_cast<int16_t>(std::lround(scaled));
}

void MicConverter::reset() {
    previousInput_ = 0;
    previousOutput_ = 0;
}

}  // namespace mining
