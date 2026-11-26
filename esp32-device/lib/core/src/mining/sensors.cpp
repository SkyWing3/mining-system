#include "mining/sensors.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <cmath>

#include "mining/log.h"

namespace mining {

// --- CoSensor -----------------------------------------------------------

CoSensor::CoSensor(AnalogInput& adc, const CoConfig& config, MonotonicClock clock)
    : adc_(adc), config_(config), clock_(std::move(clock)), started_(clock_()) {}

int CoSensor::warmupRemaining() const {
    Millis remaining = static_cast<Millis>(config_.warmupSeconds) * 1000 - (clock_() - started_);
    return remaining > 0 ? static_cast<int>((remaining + 500) / 1000) : 0;
}

bool CoSensor::read(CoReading& reading, std::string& error) {
    int64_t total = 0;
    for (int index = 0; index < config_.samples; ++index) {
        int millivolts = 0;
        if (!adc_.readMillivolts(millivolts)) {
            error = "El ADC no entregó una lectura";
            return false;
        }
        total += millivolts;
    }
    // Small negative offsets near 0 V are noise, never a concentration.
    reading.volts = std::max(0.0, static_cast<double>(total) / config_.samples / 1000.0);
    reading.ppm.reset();
    reading.warmupRemaining = warmupRemaining();
    if (reading.warmupRemaining > 0) {
        reading.state = CoState::Warming;
        return true;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    if (!config_.calibration) {
        reading.state = CoState::Uncalibrated;
        return true;
    }
    reading.ppm = config_.calibration->ppm(reading.volts);
    reading.state = CoState::Ok;
    return true;
}

void CoSensor::setCalibration(const std::optional<CoCalibration>& calibration) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.calibration = calibration;
}

// --- MLX90614 -----------------------------------------------------------

uint8_t smbusPec(const uint8_t* data, size_t length) {
    uint8_t crc = 0;
    for (size_t index = 0; index < length; ++index) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; ++bit) crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x07) : static_cast<uint8_t>(crc << 1);
    }
    return crc;
}

bool Mlx90614::read(uint8_t command, double& value, std::string& error) {
    uint8_t data[3];
    if (!bus_.readBlock(address_, command, data, sizeof data, error)) return false;
    const uint8_t frame[] = {static_cast<uint8_t>(address_ << 1), command, static_cast<uint8_t>((address_ << 1) | 1), data[0], data[1]};
    if (smbusPec(frame, sizeof frame) != data[2]) {
        error = "PEC inválido en la lectura del MLX90614";
        return false;
    }
    uint16_t raw = static_cast<uint16_t>(data[0] | (data[1] << 8));
    if (raw & 0x8000) {
        error = "El MLX90614 informó un error de lectura";
        return false;
    }
    // 0.02 K per bit.
    value = raw * 0.02 - 273.15;
    return true;
}

// --- HardwareSensors ----------------------------------------------------

namespace {
const char* const kSensorNames[2] = {"co", "termómetro"};
}

SensorSnapshot HardwareSensors::sample() {
    SensorSnapshot snapshot;
    if (co_ != nullptr) {
        CoReading reading;
        std::string error;
        if (co_->read(reading, error)) {
            snapshot.coVolts = reading.volts;
            snapshot.coPpm = reading.ppm;
            snapshot.coState = reading.state;
            snapshot.warmupRemaining = reading.warmupRemaining;
            recovered(0);
        } else {
            snapshot.coState = CoState::Error;
            failed(0, error);
        }
    }
    if (thermometer_ != nullptr) {
        double ambient = 0, object = 0;
        std::string error;
        if (thermometer_->ambientCelsius(ambient, error) && thermometer_->objectCelsius(object, error)) {
            snapshot.ambientC = ambient;
            snapshot.objectC = object;
            snapshot.thermometerState = ThermometerState::Ok;
            recovered(1);
        } else {
            snapshot.thermometerState = ThermometerState::Error;
            failed(1, error);
        }
    }
    return snapshot;
}

// Log each failure once, and its recovery, instead of every second.
void HardwareSensors::failed(int sensor, const std::string& error) {
    if (errors_[sensor] == error) return;
    errors_[sensor] = error;
    LOG_W("Sensor %s sin lectura: %s", kSensorNames[sensor], error.c_str());
}

void HardwareSensors::recovered(int sensor) {
    if (errors_[sensor].empty()) return;
    errors_[sensor].clear();
    LOG_I("Sensor %s recuperado", kSensorNames[sensor]);
}

// --- SimulatedSensors ---------------------------------------------------

namespace {
constexpr double kBaseAmbient = 24.0, kBaseObject = 26.5, kBasePpm = 6.0;
constexpr double kSpikeAmbient = 41.0, kSpikePpm = 260.0;
constexpr double kVoltsPerPpm = 0.0015, kBaselineVolts = 0.12;

double rounded(double value, int decimals) {
    double scale = std::pow(10.0, decimals);
    return std::round(value * scale) / scale;
}
}  // namespace

SimulatedSensors::SimulatedSensors(MonotonicClock clock, uint32_t seed)
    : clock_(std::move(clock)), random_(seed), ambient_(kBaseAmbient), object_(kBaseObject), ppm_(kBasePpm) {}

void SimulatedSensors::spikeGas(Millis durationMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    gasUntil_ = clock_() + durationMs;
}

void SimulatedSensors::spikeHeat(Millis durationMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    heatUntil_ = clock_() + durationMs;
}

SensorSnapshot SimulatedSensors::sample() {
    std::lock_guard<std::mutex> lock(mutex_);
    Millis now = clock_();
    double ppmTarget = now < gasUntil_ ? kSpikePpm : kBasePpm;
    double ambientTarget = now < heatUntil_ ? kSpikeAmbient : kBaseAmbient;
    auto noise = [this](double sigma) { return std::normal_distribution<double>(0.0, sigma)(random_); };
    // Move towards the target with some noise, as a real sensor would drift.
    ppm_ = std::max(0.0, ppm_ + (ppmTarget - ppm_) * 0.35 + noise(1.2));
    ambient_ += (ambientTarget - ambient_) * 0.3 + noise(0.08);
    object_ += (ambientTarget + 2.5 - object_) * 0.3 + noise(0.15);
    SensorSnapshot snapshot;
    snapshot.ambientC = rounded(ambient_, 2);
    snapshot.objectC = rounded(object_, 2);
    snapshot.coVolts = rounded(kBaselineVolts + ppm_ * kVoltsPerPpm, 4);
    snapshot.coPpm = rounded(ppm_, 1);
    snapshot.coState = CoState::Ok;
    snapshot.thermometerState = ThermometerState::Ok;
    snapshot.simulated = true;
    return snapshot;
}

// --- Telemetry ------------------------------------------------------------

namespace {
std::optional<double> limited(const std::optional<double>& value, double low, double high) {
    if (!value || !std::isfinite(*value) || *value < low || *value > high) return std::nullopt;
    return rounded(*value, 4);
}
}  // namespace

std::optional<TelemetryReading> telemetryFields(const MonitorUpdate& update) {
    const SensorSnapshot& snapshot = update.snapshot;
    TelemetryReading reading;
    reading.temperatureC = limited(snapshot.ambientC, -50.0, 150.0);
    reading.objectTemperatureC = limited(snapshot.objectC, -70.0, 380.0);
    reading.gasPpm = limited(snapshot.coPpm, 0.0, 1000000.0);
    reading.gasVoltage = limited(snapshot.coVolts, 0.0, 5.5);
    if (!reading.temperatureC && !reading.objectTemperatureC && !reading.gasPpm && !reading.gasVoltage) return std::nullopt;
    reading.level = update.assessment.level;
    reading.simulated = snapshot.simulated;
    return reading;
}

std::string telemetryFrame(const TelemetryReading& reading) {
    JsonDocument frame;
    frame["type"] = "telemetry";
    if (reading.temperatureC) frame["temperatureC"] = *reading.temperatureC;
    if (reading.objectTemperatureC) frame["objectTemperatureC"] = *reading.objectTemperatureC;
    if (reading.gasPpm) frame["gasPpm"] = *reading.gasPpm;
    if (reading.gasVoltage) frame["gasVoltage"] = *reading.gasVoltage;
    frame["level"] = levelName(reading.level);
    frame["simulated"] = reading.simulated;
    std::string out;
    serializeJson(frame, out);
    return out;
}

// --- SensorHub ------------------------------------------------------------

SensorHub::SensorHub(SensorSource& source, const AlertsConfig& alerts, Millis intervalMs, Publish publish, MonotonicClock clock)
    : source_(source), evaluator_(alerts), interval_(intervalMs), publish_(std::move(publish)), clock_(std::move(clock)) {}

MonitorUpdate SensorHub::sampleOnce() {
    MonitorUpdate update;
    update.snapshot = source_.sample();
    update.assessment = evaluator_.update(update.snapshot);
    update.sampledAt = clock_();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        latest_ = update;
    }
    if (publish_) publish_(update);
    return update;
}

std::optional<MonitorUpdate> SensorHub::latest() {
    std::lock_guard<std::mutex> lock(mutex_);
    return latest_;
}

std::optional<TelemetryReading> SensorHub::telemetry() {
    std::optional<MonitorUpdate> update = latest();
    if (!update || clock_() - update->sampledAt > std::max<Millis>(3 * interval_, 5000)) return std::nullopt;
    return telemetryFields(*update);
}

bool computeCalibration(double baselineVolts, double referenceVolts, double referencePpm, CoCalibration& out, std::string& error) {
    if (!(referencePpm > 0)) {
        error = "La concentración de referencia debe ser positiva.";
        return false;
    }
    if (referenceVolts <= baselineVolts) {
        error = "La tensión con gas no supera la línea base; repite la medición.";
        return false;
    }
    out.baselineVolts = rounded(baselineVolts, 4);
    out.ppmPerVolt = rounded(referencePpm / (referenceVolts - baselineVolts), 2);
    return true;
}

bool estimateCalibration(double baselineVolts, double supplyVolts, CoCalibration& out, std::string& error) {
    if (!(supplyVolts > 0) || !(baselineVolts > 0.01) || baselineVolts >= supplyVolts * 0.9) {
        error = "La línea base debe estar entre 0,01 V y el 90 % de la alimentación.";
        return false;
    }
    double expected = supplyVolts / (1.0 + (supplyVolts / baselineVolts - 1.0) / kDatasheetRatio);
    return computeCalibration(baselineVolts, expected, kDatasheetPpm, out, error);
}

}  // namespace mining
