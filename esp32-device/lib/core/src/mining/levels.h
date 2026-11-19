// Clasificación de lecturas en normal, precaución y peligro (alerts/levels.py).
//
// Cada métrica cambia de nivel solo después de `confirm_samples` muestras
// consecutivas, y para bajar necesita alejarse del umbral (histéresis). Así una
// lectura aislada no dispara ni apaga una alarma.
#pragma once

#include <string>
#include <vector>

#include "mining/readings.h"
#include "mining/settings.h"
#include "mining/types.h"

namespace mining {

struct Metric {
    const char* key;
    const char* label;
    const char* unit;
    double hysteresis;
    // Alarm group sent to the central: "co" or "heat".
    const char* group;
};

constexpr size_t kMetricCount = 3;
extern const Metric kMetrics[kMetricCount];

struct Condition {
    const Metric* metric;
    Level level;
    double value;

    // Por ejemplo "CO 245 ppm" o "Ambiente 41.0 °C".
    std::string text() const;
};

struct Assessment {
    Level level = Level::Normal;
    std::vector<Condition> conditions;

    Level groupLevel(const std::string& group) const;
    // Texto corto de la alarma automática con las condiciones en peligro del grupo.
    std::string detail(const std::string& group) const;
};

Level classify(double value, const Threshold& threshold, Level current, double hysteresis);

class ThresholdEvaluator {
public:
    explicit ThresholdEvaluator(const AlertsConfig& config);

    Assessment update(const SensorSnapshot& snapshot);

private:
    struct State {
        Level level = Level::Normal;
        bool hasPending = false;
        Level pending = Level::Normal;
        int count = 0;
        bool hasValue = false;
        double value = 0;
    };

    const Threshold& threshold(size_t metric) const;
    void step(size_t metric, double value);

    AlertsConfig config_;
    State states_[kMetricCount];
};

}  // namespace mining
