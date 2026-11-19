// Instantánea de los sensores, independiente del hardware que la produjo.
#pragma once

#include <cstdint>
#include <optional>

namespace mining {

// Estado del SEN0564 que se muestra en la OLED y decide qué se transmite.
enum class CoState : uint8_t { Disabled, Error, Warming, Uncalibrated, Ok };
enum class ThermometerState : uint8_t { Disabled, Error, Ok };

struct SensorSnapshot {
    std::optional<double> ambientC;
    std::optional<double> objectC;
    std::optional<double> coVolts;
    std::optional<double> coPpm;
    CoState coState = CoState::Disabled;
    ThermometerState thermometerState = ThermometerState::Disabled;
    int warmupRemaining = 0;
    bool simulated = false;

    bool hasMeasurements() const { return ambientC || objectC || coVolts || coPpm; }
};

}  // namespace mining
