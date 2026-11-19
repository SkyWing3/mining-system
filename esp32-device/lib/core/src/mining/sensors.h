// Sensores y muestreo periódico (sensors/*.py).
//
// SEN0564 (CO) en un GPIO con ADC1 del ESP32 y MLX90614 por SMBus. Los accesos
// al hardware pasan por interfaces pequeñas que el firmware implementa con el
// ADC y Wire, y las pruebas con dobles.
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <random>
#include <string>

#include "mining/events.h"
#include "mining/levels.h"
#include "mining/readings.h"
#include "mining/settings.h"

namespace mining {

class AnalogInput {
public:
    virtual ~AnalogInput() = default;
    virtual bool readMillivolts(int& millivolts) = 0;
};

class SmBus {
public:
    virtual ~SmBus() = default;
    // Write `command`, repeated start, read `length` bytes.
    virtual bool readBlock(uint8_t address, uint8_t command, uint8_t* data, size_t length, std::string& error) = 0;
};

// --- SEN0564 -----------------------------------------------------------
// El fabricante lo define como sensor cualitativo: solo se informan ppm con
// una calibración configurada y después del precalentamiento.

struct CoReading {
    double volts = 0;
    std::optional<double> ppm;
    CoState state = CoState::Warming;
    int warmupRemaining = 0;
};

class CoSensor {
public:
    CoSensor(AnalogInput& adc, const CoConfig& config, MonotonicClock clock);

    int warmupRemaining() const;
    bool read(CoReading& reading, std::string& error);
    void setCalibration(const std::optional<CoCalibration>& calibration);

private:
    AnalogInput& adc_;
    CoConfig config_;
    MonotonicClock clock_;
    Millis started_;
    mutable std::mutex mutex_;
};

// --- MLX90614 ----------------------------------------------------------

// CRC-8 (x^8 + x^2 + x + 1) used by SMBus as Packet Error Code.
uint8_t smbusPec(const uint8_t* data, size_t length);

class Mlx90614 {
public:
    static constexpr uint8_t kAmbientRegister = 0x06;
    static constexpr uint8_t kObjectRegister = 0x07;

    Mlx90614(SmBus& bus, uint8_t address) : bus_(bus), address_(address) {}

    bool ambientCelsius(double& value, std::string& error) { return read(kAmbientRegister, value, error); }
    bool objectCelsius(double& value, std::string& error) { return read(kObjectRegister, value, error); }

private:
    bool read(uint8_t command, double& value, std::string& error);

    SmBus& bus_;
    uint8_t address_;
};

// --- Sources ----------------------------------------------------------

class SensorSource {
public:
    virtual ~SensorSource() = default;
    virtual SensorSnapshot sample() = 0;
};

// Cada sensor falla por separado: un error se informa en la OLED y no detiene al otro.
class HardwareSensors : public SensorSource {
public:
    HardwareSensors(CoSensor* co, Mlx90614* thermometer) : co_(co), thermometer_(thermometer) {}
    SensorSnapshot sample() override;

private:
    void failed(int sensor, const std::string& error);
    void recovered(int sensor);

    CoSensor* co_;
    Mlx90614* thermometer_;
    std::string errors_[2];
};

// Lecturas sintéticas marcadas como simuladas; permite forzar picos para demostraciones.
class SimulatedSensors : public SensorSource {
public:
    explicit SimulatedSensors(MonotonicClock clock, uint32_t seed = 1);
    void spikeGas(Millis durationMs = 25000);
    void spikeHeat(Millis durationMs = 25000);
    SensorSnapshot sample() override;

private:
    MonotonicClock clock_;
    std::mutex mutex_;
    std::mt19937 random_;
    Millis gasUntil_ = 0;
    Millis heatUntil_ = 0;
    double ambient_, object_, ppm_;
};

// --- Telemetry -----------------------------------------------------------

struct TelemetryReading {
    std::optional<double> temperatureC;
    std::optional<double> objectTemperatureC;
    std::optional<double> gasPpm;
    std::optional<double> gasVoltage;
    Level level = Level::Normal;
    bool simulated = false;
};

// Values outside the transport limits accepted by the central (docs/api.md) are dropped.
std::optional<TelemetryReading> telemetryFields(const MonitorUpdate& update);
std::string telemetryFrame(const TelemetryReading& reading);

// --- Hub ---------------------------------------------------------------

// Cada muestra se clasifica y se publica a la tarea principal; el enlace lee la
// última muestra para transmitirla como telemetría en vivo.
class SensorHub {
public:
    using Publish = std::function<void(const MonitorUpdate&)>;

    SensorHub(SensorSource& source, const AlertsConfig& alerts, Millis intervalMs, Publish publish, MonotonicClock clock);

    MonitorUpdate sampleOnce();
    std::optional<MonitorUpdate> latest();
    // Latest sample as telemetry, or nothing when there is no recent sample.
    std::optional<TelemetryReading> telemetry();
    Millis intervalMs() const { return interval_; }

private:
    SensorSource& source_;
    ThresholdEvaluator evaluator_;
    Millis interval_;
    Publish publish_;
    MonotonicClock clock_;
    std::mutex mutex_;
    std::optional<MonitorUpdate> latest_;
};

// Calibración por dos puntos (tools/calibrate_co.py): línea base en aire limpio y
// tensión con un gas de referencia de concentración conocida.
bool computeCalibration(double baselineVolts, double referenceVolts, double referencePpm, CoCalibration& out, std::string& error);

}  // namespace mining
