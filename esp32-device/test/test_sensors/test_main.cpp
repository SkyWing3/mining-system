// Sensores, telemetría, audio y hora (equivalente a tests/test_sensors.py y la parte WAV de test_audio.py).
#include <unity.h>

#include <ArduinoJson.h>

#include <cstring>

#include "../fakes.h"
#include "mining/sensors.h"
#include "mining/wallclock.h"
#include "mining/wav.h"

using namespace mining;

void setUp() {}
void tearDown() {}

void test_mlx90614_pec_matches_the_datasheet_example() {
    // Melexis datasheet: SA=0x5A, read RAM 0x07, data 0x3AD2, PEC 0x30.
    const uint8_t frame[] = {0xB4, 0x07, 0xB5, 0xD2, 0x3A};
    TEST_ASSERT_EQUAL_HEX8(0x30, smbusPec(frame, sizeof frame));
}

void test_mlx90614_celsius_error_flag_and_pec() {
    FakeBus bus;
    Mlx90614 sensor(bus, 0x5A);
    double value = 0;
    std::string error;
    TEST_ASSERT_TRUE(sensor.ambientCelsius(value, error));
    TEST_ASSERT_DOUBLE_WITHIN(0.001, 28.01, value);
    bus.objectRaw = 0x8000 | 0x3AD2;
    TEST_ASSERT_FALSE(sensor.objectCelsius(value, error));
    TEST_ASSERT_TRUE(error.find("error de lectura") != std::string::npos);
    bus.corruptPec = true;
    TEST_ASSERT_FALSE(sensor.ambientCelsius(value, error));
    TEST_ASSERT_TRUE(error.find("PEC") != std::string::npos);
}

void test_co_requires_warmup_and_calibration_for_ppm() {
    FakeClock clock;
    FakeAnalog adc;
    adc.millivolts = 600;
    CoConfig config;
    config.warmupSeconds = 180;
    CoSensor sensor(adc, config, clock.fn());
    CoReading reading;
    std::string error;
    TEST_ASSERT_TRUE(sensor.read(reading, error));
    TEST_ASSERT_EQUAL(CoState::Warming, reading.state);
    TEST_ASSERT_EQUAL(180, reading.warmupRemaining);
    TEST_ASSERT_DOUBLE_WITHIN(1e-9, 0.6, reading.volts);
    TEST_ASSERT_FALSE(reading.ppm.has_value());
    clock.now = 180000;
    TEST_ASSERT_TRUE(sensor.read(reading, error));
    TEST_ASSERT_EQUAL(CoState::Uncalibrated, reading.state);
    TEST_ASSERT_FALSE(reading.ppm.has_value());
    sensor.setCalibration(CoCalibration{0.4, 250});
    TEST_ASSERT_TRUE(sensor.read(reading, error));
    TEST_ASSERT_EQUAL(CoState::Ok, reading.state);
    TEST_ASSERT_DOUBLE_WITHIN(1e-6, 50.0, *reading.ppm);
    // Below the baseline the concentration is zero, never negative.
    adc.millivolts = 300;
    TEST_ASSERT_TRUE(sensor.read(reading, error));
    TEST_ASSERT_EQUAL_DOUBLE(0.0, *reading.ppm);
}

void test_hardware_source_isolates_each_sensor_failure() {
    FakeClock clock;
    FakeAnalog adc;
    FakeBus bus;
    CoConfig config;
    config.warmupSeconds = 0;
    CoSensor co(adc, config, clock.fn());
    Mlx90614 thermometer(bus, 0x5A);
    HardwareSensors sensors(&co, &thermometer);
    bus.fail = true;
    SensorSnapshot snapshot = sensors.sample();
    TEST_ASSERT_EQUAL(ThermometerState::Error, snapshot.thermometerState);
    TEST_ASSERT_EQUAL(CoState::Uncalibrated, snapshot.coState);
    TEST_ASSERT_TRUE(snapshot.coVolts.has_value());
    bus.fail = false;
    adc.fail = true;
    snapshot = sensors.sample();
    TEST_ASSERT_EQUAL(ThermometerState::Ok, snapshot.thermometerState);
    TEST_ASSERT_EQUAL(CoState::Error, snapshot.coState);
    TEST_ASSERT_FALSE(snapshot.coVolts.has_value());
    HardwareSensors none(nullptr, nullptr);
    snapshot = none.sample();
    TEST_ASSERT_EQUAL(CoState::Disabled, snapshot.coState);
    TEST_ASSERT_FALSE(snapshot.hasMeasurements());
}

void test_simulated_source_is_marked_and_can_spike() {
    FakeClock clock;
    SimulatedSensors sensors(clock.fn(), 7);
    SensorSnapshot snapshot = sensors.sample();
    TEST_ASSERT_TRUE(snapshot.simulated);
    TEST_ASSERT_TRUE(*snapshot.coPpm < 35);
    sensors.spikeGas();
    for (int i = 0; i < 12; ++i) snapshot = sensors.sample();
    TEST_ASSERT_TRUE(*snapshot.coPpm > 200);
    clock.now = 30000;
    for (int i = 0; i < 20; ++i) snapshot = sensors.sample();
    TEST_ASSERT_TRUE(*snapshot.coPpm < 35);
    sensors.spikeHeat();
    for (int i = 0; i < 20; ++i) snapshot = sensors.sample();
    TEST_ASSERT_TRUE(*snapshot.ambientC > 38);
}

void test_telemetry_drops_out_of_range_values_and_keeps_level() {
    MonitorUpdate update;
    update.snapshot.ambientC = 200.0;
    update.snapshot.objectC = 25.123456;
    update.snapshot.coVolts = 0.41;
    update.assessment.level = Level::Danger;
    std::optional<TelemetryReading> reading = telemetryFields(update);
    TEST_ASSERT_TRUE(reading.has_value());
    TEST_ASSERT_FALSE(reading->temperatureC.has_value());
    TEST_ASSERT_DOUBLE_WITHIN(1e-9, 25.1235, *reading->objectTemperatureC);
    TEST_ASSERT_EQUAL(Level::Danger, reading->level);
    JsonDocument frame;
    deserializeJson(frame, telemetryFrame(*reading));
    TEST_ASSERT_EQUAL_STRING("telemetry", frame["type"]);
    TEST_ASSERT_EQUAL_STRING("danger", frame["level"]);
    TEST_ASSERT_TRUE(frame["temperatureC"].isNull());
    TEST_ASSERT_TRUE(frame["gasPpm"].isNull());
    MonitorUpdate empty;
    TEST_ASSERT_FALSE(telemetryFields(empty).has_value());
}

void test_hub_publishes_and_expires_stale_samples() {
    FakeClock clock;
    SimulatedSensors sensors(clock.fn());
    int published = 0;
    AlertsConfig alerts;
    SensorHub hub(sensors, alerts, 1000, [&](const MonitorUpdate&) { ++published; }, clock.fn());
    TEST_ASSERT_FALSE(hub.telemetry().has_value());
    hub.sampleOnce();
    TEST_ASSERT_EQUAL(1, published);
    TEST_ASSERT_TRUE(hub.telemetry().has_value());
    TEST_ASSERT_TRUE(hub.telemetry()->simulated);
    clock.now = 5000;
    TEST_ASSERT_TRUE(hub.telemetry().has_value());
    clock.now = 5001;
    TEST_ASSERT_FALSE(hub.telemetry().has_value());
}

void test_calibration_by_two_points() {
    CoCalibration calibration;
    std::string error;
    TEST_ASSERT_TRUE(computeCalibration(0.41234, 0.81234, 100, calibration, error));
    TEST_ASSERT_DOUBLE_WITHIN(1e-9, 0.4123, calibration.baselineVolts);
    TEST_ASSERT_DOUBLE_WITHIN(1e-9, 250.0, calibration.ppmPerVolt);
    TEST_ASSERT_FALSE(computeCalibration(0.5, 0.4, 100, calibration, error));
    TEST_ASSERT_FALSE(computeCalibration(0.4, 0.5, 0, calibration, error));
}

void test_wav_header_is_mono_16_bit_pcm() {
    uint8_t header[kWavHeaderBytes];
    writeWavHeader(header, 16000, 32000);
    TEST_ASSERT_EQUAL_MEMORY("RIFF", header, 4);
    TEST_ASSERT_EQUAL_MEMORY("WAVEfmt ", header + 8, 8);
    TEST_ASSERT_EQUAL_MEMORY("data", header + 36, 4);
    auto u32 = [&](int at) { return header[at] | header[at + 1] << 8 | header[at + 2] << 16 | header[at + 3] << 24; };
    auto u16 = [&](int at) { return header[at] | header[at + 1] << 8; };
    TEST_ASSERT_EQUAL(36 + 32000, u32(4));
    TEST_ASSERT_EQUAL(1, u16(20));
    TEST_ASSERT_EQUAL(1, u16(22));
    TEST_ASSERT_EQUAL(16000, u32(24));
    TEST_ASSERT_EQUAL(32000, u32(28));
    TEST_ASSERT_EQUAL(16, u16(34));
    TEST_ASSERT_EQUAL(32000, u32(40));
}

void test_normalization_raises_quiet_audio_without_clipping() {
    TEST_ASSERT_EQUAL_DOUBLE(1.0, normalizationGain(0));
    TEST_ASSERT_EQUAL_DOUBLE(8.0, normalizationGain(100));
    TEST_ASSERT_DOUBLE_WITHIN(1e-9, 0.89 * 32767 / 10000, normalizationGain(10000));
    TEST_ASSERT_EQUAL_DOUBLE(1.0, normalizationGain(32000));
    TEST_ASSERT_EQUAL(800, scaleSample(100, 8.0));
    TEST_ASSERT_EQUAL(32767, scaleSample(30000, 2.0));
    TEST_ASSERT_EQUAL(-32767, scaleSample(-30000, 2.0));
}

void test_microphone_conversion_removes_dc_offset() {
    MicConverter converter;
    // A constant 24-bit offset settles towards zero.
    int16_t last = 0;
    for (int i = 0; i < 4000; ++i) last = converter.convert(static_cast<int32_t>(50000) << 8);
    TEST_ASSERT_TRUE(last > -10 && last < 10);
    // A step shows up with the fixed pre-gain (24-bit >> 5) and saturates without wrapping.
    converter.reset();
    TEST_ASSERT_EQUAL(1000, converter.convert(static_cast<int32_t>(32000) << 8));
    converter.reset();
    TEST_ASSERT_EQUAL(32767, converter.convert(static_cast<int32_t>(4000000) << 8));
    converter.reset();
    TEST_ASSERT_EQUAL(-32767, converter.convert(static_cast<int32_t>(-4000000) * 256));
}

void test_iso_time_round_trip() {
    TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:00.000Z", formatIso(0).c_str());
    TEST_ASSERT_EQUAL_STRING("2024-02-29T23:59:59.999Z", formatIso(1709251199999).c_str());
    int64_t epoch = 0;
    TEST_ASSERT_TRUE(parseIso("2026-11-16T19:04:05.1234567Z", epoch));
    TEST_ASSERT_EQUAL_STRING("2026-11-16T19:04:05.123Z", formatIso(epoch).c_str());
    TEST_ASSERT_TRUE(parseIso("2026-11-16T15:04:05-04:00", epoch));
    TEST_ASSERT_EQUAL_STRING("2026-11-16T19:04:05.000Z", formatIso(epoch).c_str());
    TEST_ASSERT_TRUE(parseIso("2026-11-16T19:04:05", epoch));
    TEST_ASSERT_FALSE(parseIso("2026-11-16", epoch));
    TEST_ASSERT_FALSE(parseIso("2026-13-16T19:04:05Z", epoch));
    TEST_ASSERT_FALSE(parseIso("2026-11-16T19:04:05Zx", epoch));
}

void test_wall_clock_resolves_stamps_of_the_same_boot() {
    FakeClock uptime;
    WallClock clock(4, uptime.fn());
    uptime.now = 1000;
    Stamp early = clock.stamp();
    TEST_ASSERT_FALSE(early.absolute());
    TEST_ASSERT_FALSE(clock.resolve(early).has_value());
    uptime.now = 61000;
    clock.sync(1763320000000);
    TEST_ASSERT_EQUAL_INT64(1763320000000 - 60000, *clock.resolve(early));
    TEST_ASSERT_FALSE(clock.resolve(Stamp{-1, 3, 1000}).has_value());
    // Small differences (network latency) do not move the clock; large ones do.
    clock.sync(1763320000500);
    TEST_ASSERT_EQUAL_INT64(1763320000000, *clock.now());
    clock.sync(1763320005000);
    TEST_ASSERT_EQUAL_INT64(1763320005000, *clock.now());
    TEST_ASSERT_TRUE(clock.stamp().absolute());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_mlx90614_pec_matches_the_datasheet_example);
    RUN_TEST(test_mlx90614_celsius_error_flag_and_pec);
    RUN_TEST(test_co_requires_warmup_and_calibration_for_ppm);
    RUN_TEST(test_hardware_source_isolates_each_sensor_failure);
    RUN_TEST(test_simulated_source_is_marked_and_can_spike);
    RUN_TEST(test_telemetry_drops_out_of_range_values_and_keeps_level);
    RUN_TEST(test_hub_publishes_and_expires_stale_samples);
    RUN_TEST(test_calibration_by_two_points);
    RUN_TEST(test_wav_header_is_mono_16_bit_pcm);
    RUN_TEST(test_normalization_raises_quiet_audio_without_clipping);
    RUN_TEST(test_microphone_conversion_removes_dc_offset);
    RUN_TEST(test_iso_time_round_trip);
    RUN_TEST(test_wall_clock_resolves_stamps_of_the_same_boot);
    return UNITY_END();
}
