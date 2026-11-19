// Audio PCM de 16 bits: cabecera WAV, conversión del INMP441 y normalización
// (audio/wav.py). El INMP441 graba bajo; la ganancia se calcula con el pico de
// la grabación y se aplica al subirla, sin reescribir el archivo en la flash.
#pragma once

#include <cstddef>
#include <cstdint>

namespace mining {

constexpr size_t kWavHeaderBytes = 44;
constexpr int kFullScale = 32767;

void writeWavHeader(uint8_t* header, uint32_t sampleRate, uint32_t dataBytes);

// Ganancia para llevar el pico a `targetPeak` sin recortar, como máximo `maxGain`; nunca menor que 1.
double normalizationGain(int peak, double targetPeak = 0.89, double maxGain = 8.0);
int16_t scaleSample(int16_t sample, double gain);

// Convierte las palabras de 32 bits del INMP441 (24 bits útiles alineados a la
// izquierda) en PCM de 16 bits: elimina la componente continua y aplica una
// preamplificación fija de +18 dB con saturación.
class MicConverter {
public:
    int16_t convert(int32_t raw);
    void reset();

private:
    float previousInput_ = 0;
    float previousOutput_ = 0;
};

}  // namespace mining
