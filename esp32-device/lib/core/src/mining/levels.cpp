#include "mining/levels.h"

#include <cstdio>

namespace mining {

const Metric kMetrics[kMetricCount] = {
    {"co", "CO", "ppm", 5.0, "co"},
    {"ambient", "Ambiente", "\xC2\xB0" "C", 1.0, "heat"},
    {"object", "Objeto", "\xC2\xB0" "C", 2.0, "heat"},
};

const char* levelName(Level level) {
    switch (level) {
        case Level::Caution: return "caution";
        case Level::Danger: return "danger";
        default: return "normal";
    }
}

const char* levelLabel(Level level) {
    switch (level) {
        case Level::Caution: return "Precaución";
        case Level::Danger: return "PELIGRO";
        default: return "Normal";
    }
}

std::string Condition::text() const {
    char buffer[48];
    bool ppm = std::string(metric->unit) == "ppm";
    snprintf(buffer, sizeof buffer, ppm ? "%s %.0f %s" : "%s %.1f %s", metric->label, value, metric->unit);
    return buffer;
}

Level Assessment::groupLevel(const std::string& group) const {
    Level result = Level::Normal;
    for (const auto& condition : conditions) {
        if (group == condition.metric->group && condition.level > result) result = condition.level;
    }
    return result;
}

std::string Assessment::detail(const std::string& group) const {
    std::string text;
    for (const auto& condition : conditions) {
        if (group != condition.metric->group || condition.level != Level::Danger) continue;
        if (!text.empty()) text += ", ";
        text += condition.text();
    }
    return text;
}

Level classify(double value, const Threshold& threshold, Level current, double hysteresis) {
    if (value >= threshold.danger || (current == Level::Danger && value > threshold.danger - hysteresis)) return Level::Danger;
    if (value >= threshold.caution || (current >= Level::Caution && value > threshold.caution - hysteresis)) return Level::Caution;
    return Level::Normal;
}

ThresholdEvaluator::ThresholdEvaluator(const AlertsConfig& config) : config_(config) {}

const Threshold& ThresholdEvaluator::threshold(size_t metric) const {
    return metric == 0 ? config_.coPpm : metric == 1 ? config_.ambientC : config_.objectC;
}

Assessment ThresholdEvaluator::update(const SensorSnapshot& snapshot) {
    const std::optional<double> values[kMetricCount] = {snapshot.coPpm, snapshot.ambientC, snapshot.objectC};
    Assessment assessment;
    for (size_t index = 0; index < kMetricCount; ++index) {
        // Without a value there is no evidence to change the level.
        if (values[index]) step(index, *values[index]);
        const State& state = states_[index];
        if (state.level != Level::Normal && state.hasValue) {
            assessment.conditions.push_back({&kMetrics[index], state.level, state.value});
            if (state.level > assessment.level) assessment.level = state.level;
        }
    }
    return assessment;
}

void ThresholdEvaluator::step(size_t metric, double value) {
    State& state = states_[metric];
    state.value = value;
    state.hasValue = true;
    Level target = classify(value, threshold(metric), state.level, kMetrics[metric].hysteresis);
    if (target == state.level) {
        state.hasPending = false;
        state.count = 0;
        return;
    }
    if (state.hasPending && target == state.pending) {
        state.count += 1;
    } else {
        state.hasPending = true;
        state.pending = target;
        state.count = 1;
    }
    if (state.count >= config_.confirmSamples) {
        state.level = target;
        state.hasPending = false;
        state.count = 0;
    }
}

}  // namespace mining
