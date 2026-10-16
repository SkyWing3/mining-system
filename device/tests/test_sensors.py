import unittest

from src.alerts.levels import CAUTION, DANGER, NORMAL, Assessment, ThresholdEvaluator, classify
from src.config import AlertsConfig, CoCalibration, CoConfig, SensorsConfig, Threshold, ThermometerConfig
from src.sensors.ads1115 import Ads1115
from src.sensors.co import CoSensor
from src.sensors.hub import MonitorUpdate, SensorHub, telemetry_fields
from src.sensors.mlx90614 import Mlx90614
from src.sensors.readings import (CO_ERROR, CO_OK, CO_UNCALIBRATED, CO_WARMING, THERMOMETER_ERROR, THERMOMETER_OK,
                                  SensorSnapshot)
from src.sensors.sources import HardwareSensors, SimulatedSensors


class FakeBus:
    def __init__(self, conversion=0x1000, words=None, ready=True):
        self.conversion = conversion
        self.words = words or {0x06: 14975, 0x07: 15125}
        self.ready = ready
        self.writes = []

    def write_i2c_block_data(self, address, register, data):
        self.writes.append((address, register, data))

    def read_i2c_block_data(self, address, register, length):
        if register == 0x01:
            return [0x80 if self.ready else 0x00, 0x00]
        if isinstance(self.conversion, Exception):
            raise self.conversion
        return list(self.conversion.to_bytes(2, "big", signed=True))

    def read_word_data(self, address, register):
        value = self.words[register]
        if isinstance(value, Exception):
            raise value
        return value


class Clock:
    def __init__(self, now=0.0):
        self.now = now

    def __call__(self):
        return self.now


class DriverTests(unittest.TestCase):
    def test_ads1115_single_shot_config_and_voltage(self):
        bus = FakeBus(conversion=8000)
        adc = Ads1115(bus, 0x48, sleep=lambda _: None)
        self.assertEqual(adc.config_word(0), 0xC383)
        volts = adc.read_volts(0, samples=2)
        self.assertAlmostEqual(volts, 8000 * 4.096 / 32768)
        self.assertEqual(bus.writes[0], (0x48, 0x01, [0xC3, 0x83]))
        self.assertEqual(len(bus.writes), 2)
        self.assertEqual(adc.config_word(3) >> 12 & 0b111, 0b111)

    def test_ads1115_timeout_and_invalid_channel(self):
        adc = Ads1115(FakeBus(ready=False), sleep=lambda _: None)
        with self.assertRaises(OSError):
            adc.read_volts(0)
        with self.assertRaises(ValueError):
            adc.config_word(4)

    def test_mlx90614_celsius_and_error_flag(self):
        sensor = Mlx90614(FakeBus(words={0x06: 14975, 0x07: 0x8001}))
        self.assertAlmostEqual(sensor.ambient_celsius(), 14975 * 0.02 - 273.15)
        with self.assertRaises(OSError):
            sensor.object_celsius()

    def test_co_requires_warmup_and_calibration_for_ppm(self):
        clock = Clock()
        adc = Ads1115(FakeBus(conversion=8000), sleep=lambda _: None)
        warming = CoSensor(adc, CoConfig(warmup_seconds=60), clock).read()
        self.assertEqual((warming.state, warming.ppm, warming.warmup_remaining), (CO_WARMING, None, 60))
        clock.now = 61
        self.assertEqual(CoSensor(adc, CoConfig(warmup_seconds=0), clock).read().state, CO_UNCALIBRATED)
        calibrated = CoSensor(adc, CoConfig(warmup_seconds=0, calibration=CoCalibration(0.5, 100)), clock).read()
        self.assertEqual(calibrated.state, CO_OK)
        self.assertAlmostEqual(calibrated.ppm, (8000 * 4.096 / 32768 - 0.5) * 100)
        self.assertEqual(CoCalibration(1.5, 100).ppm(1.0), 0)

    def test_hardware_source_isolates_each_sensor_failure(self):
        config = SensorsConfig(co=CoConfig(warmup_seconds=0), mlx90614=ThermometerConfig())
        bus = FakeBus(conversion=OSError("i2c timeout"))
        snapshot = HardwareSensors(config, bus=bus).sample()
        self.assertEqual(snapshot.co_state, CO_ERROR)
        self.assertEqual(snapshot.thermometer_state, THERMOMETER_OK)
        self.assertIsNotNone(snapshot.ambient_c)
        bus = FakeBus(words={0x06: OSError("nack"), 0x07: 1})
        snapshot = HardwareSensors(config, bus=bus).sample()
        self.assertEqual(snapshot.thermometer_state, THERMOMETER_ERROR)
        self.assertEqual(snapshot.co_state, CO_UNCALIBRATED)

    def test_simulated_source_is_marked_and_can_spike(self):
        clock = Clock()
        sensors = SimulatedSensors(seed=1, clock=clock)
        baseline = sensors.sample()
        self.assertTrue(baseline.simulated)
        self.assertLess(baseline.co_ppm, 35)
        sensors.spike_gas(30)
        for _ in range(15):
            spiked = sensors.sample()
        self.assertGreater(spiked.co_ppm, 200)


class LevelTests(unittest.TestCase):
    def config(self, confirm=3):
        return AlertsConfig(confirm_samples=confirm, co_ppm=Threshold(35, 200), ambient_c=Threshold(32, 38), object_c=Threshold(60, 90))

    def test_classify_uses_hysteresis(self):
        threshold = Threshold(35, 200)
        self.assertEqual(classify(199, threshold, NORMAL, 5), CAUTION)
        self.assertEqual(classify(197, threshold, DANGER, 5), DANGER)
        self.assertEqual(classify(194, threshold, DANGER, 5), CAUTION)
        self.assertEqual(classify(31, threshold, CAUTION, 5), CAUTION)
        self.assertEqual(classify(29, threshold, CAUTION, 5), NORMAL)

    def test_level_changes_only_after_consecutive_samples(self):
        evaluator = ThresholdEvaluator(self.config())
        high = SensorSnapshot(co_ppm=250)
        self.assertEqual(evaluator.update(high).level, NORMAL)
        self.assertEqual(evaluator.update(SensorSnapshot(co_ppm=10)).level, NORMAL)
        for _ in range(2):
            self.assertEqual(evaluator.update(high).level, NORMAL)
        assessment = evaluator.update(high)
        self.assertEqual(assessment.level, DANGER)
        self.assertEqual(assessment.detail("co"), "CO 250 ppm")
        self.assertEqual(assessment.group_level("heat"), NORMAL)
        # Missing values never clear an alarm.
        self.assertEqual(evaluator.update(SensorSnapshot()).level, DANGER)
        for _ in range(3):
            assessment = evaluator.update(SensorSnapshot(co_ppm=5))
        self.assertEqual(assessment.level, NORMAL)

    def test_heat_group_combines_ambient_and_object(self):
        evaluator = ThresholdEvaluator(self.config(confirm=1))
        assessment = evaluator.update(SensorSnapshot(ambient_c=33.0, object_c=95.0))
        self.assertEqual(assessment.level, DANGER)
        self.assertEqual(assessment.group_level("heat"), DANGER)
        self.assertEqual(assessment.detail("heat"), "Objeto 95.0 °C")


class HubTests(unittest.TestCase):
    def test_telemetry_drops_out_of_range_values_and_keeps_level(self):
        snapshot = SensorSnapshot(ambient_c=24.123456, object_c=500.0, co_volts=0.41234, co_ppm=None, simulated=True)
        fields = telemetry_fields(MonitorUpdate(snapshot, Assessment(CAUTION), 0))
        self.assertEqual(fields, {"temperatureC": 24.1235, "gasVoltage": 0.4123, "level": CAUTION, "simulated": True})
        self.assertIsNone(telemetry_fields(MonitorUpdate(SensorSnapshot(), Assessment(), 0)))

    def test_hub_publishes_and_expires_stale_samples(self):
        clock = Clock()
        published = []
        hub = SensorHub(SimulatedSensors(seed=2, clock=clock), ThresholdEvaluator(AlertsConfig()), 1, published.append, clock)
        self.assertIsNone(hub.telemetry())
        hub.sample_once()
        self.assertEqual(len(published), 1)
        self.assertTrue(hub.telemetry()["simulated"])
        clock.now = 10
        self.assertIsNone(hub.telemetry())


if __name__ == "__main__":
    unittest.main()
