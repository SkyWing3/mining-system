// Umbrales con histéresis y reglas de aviso (equivalente a tests/test_alerts.py y parte de test_sensors.py).
#include <unity.h>

#include "../fakes.h"
#include "mining/alerts.h"
#include "mining/levels.h"

using namespace mining;

void setUp() {}
void tearDown() {}

static SensorSnapshot snapshot(std::optional<double> ppm, std::optional<double> ambient = std::nullopt,
                               std::optional<double> object = std::nullopt) {
    SensorSnapshot value;
    value.coPpm = ppm;
    value.ambientC = ambient;
    value.objectC = object;
    return value;
}

void test_classify_uses_hysteresis() {
    Threshold threshold{35, 200};
    TEST_ASSERT_EQUAL(Level::Caution, classify(36, threshold, Level::Normal, 5));
    TEST_ASSERT_EQUAL(Level::Caution, classify(31, threshold, Level::Caution, 5));
    TEST_ASSERT_EQUAL(Level::Normal, classify(30, threshold, Level::Caution, 5));
    TEST_ASSERT_EQUAL(Level::Danger, classify(196, threshold, Level::Danger, 5));
    TEST_ASSERT_EQUAL(Level::Caution, classify(195, threshold, Level::Danger, 5));
    TEST_ASSERT_EQUAL(Level::Normal, classify(10, threshold, Level::Normal, 5));
}

void test_level_changes_only_after_consecutive_samples() {
    AlertsConfig config;
    config.confirmSamples = 3;
    ThresholdEvaluator evaluator(config);
    TEST_ASSERT_EQUAL(Level::Normal, evaluator.update(snapshot(250)).level);
    TEST_ASSERT_EQUAL(Level::Normal, evaluator.update(snapshot(250)).level);
    // A sample without a value is no evidence either way.
    TEST_ASSERT_EQUAL(Level::Normal, evaluator.update(snapshot(std::nullopt)).level);
    Assessment danger = evaluator.update(snapshot(250));
    TEST_ASSERT_EQUAL(Level::Danger, danger.level);
    TEST_ASSERT_EQUAL_STRING("CO 250 ppm", danger.detail("co").c_str());
    // An isolated low reading does not clear the alarm.
    TEST_ASSERT_EQUAL(Level::Danger, evaluator.update(snapshot(5)).level);
    TEST_ASSERT_EQUAL(Level::Danger, evaluator.update(snapshot(250)).level);
    for (int i = 0; i < 2; ++i) evaluator.update(snapshot(5));
    TEST_ASSERT_EQUAL(Level::Normal, evaluator.update(snapshot(5)).level);
}

void test_heat_group_combines_ambient_and_object() {
    AlertsConfig config;
    config.confirmSamples = 1;
    ThresholdEvaluator evaluator(config);
    Assessment assessment = evaluator.update(snapshot(5, 41.0, 95.0));
    TEST_ASSERT_EQUAL(Level::Danger, assessment.level);
    TEST_ASSERT_EQUAL(Level::Danger, assessment.groupLevel("heat"));
    TEST_ASSERT_EQUAL(Level::Normal, assessment.groupLevel("co"));
    TEST_ASSERT_EQUAL_STRING("Ambiente 41.0 \xC2\xB0" "C, Objeto 95.0 \xC2\xB0" "C", assessment.detail("heat").c_str());
    TEST_ASSERT_EQUAL_STRING("", assessment.detail("co").c_str());
}

void test_led_follows_link_and_level() {
    FakeClock clock;
    RecordingOutputs outputs;
    AlertController alerts(outputs, 60, true, true, clock.fn());
    TEST_ASSERT_EQUAL(LedColor::Blue, outputs.last("led")->color);
    TEST_ASSERT_FALSE(outputs.last("led")->blink);
    alerts.onConnection(true);
    TEST_ASSERT_EQUAL(LedColor::Green, outputs.last("led")->color);
    alerts.onLevel(Level::Caution);
    TEST_ASSERT_EQUAL(LedColor::Yellow, outputs.last("led")->color);
    TEST_ASSERT_EQUAL(150, outputs.last("buzz")->on);
    alerts.onLevel(Level::Danger);
    TEST_ASSERT_EQUAL(LedColor::Red, outputs.last("led")->color);
    TEST_ASSERT_TRUE(outputs.last("led")->blink);
    alerts.onLevel(Level::Normal);
    TEST_ASSERT_EQUAL(LedColor::Green, outputs.last("led")->color);
    // Same state again: the LED is not re-sent (it would restart the blink).
    size_t leds = outputs.count("led");
    alerts.onConnection(true);
    TEST_ASSERT_EQUAL(leds, outputs.count("led"));
}

void test_danger_alarm_can_be_silenced_and_resumes() {
    FakeClock clock;
    RecordingOutputs outputs;
    AlertController alerts(outputs, 60, true, true, clock.fn());
    alerts.onLevel(Level::Danger);
    TEST_ASSERT_EQUAL(-1, outputs.last("buzz")->count);
    TEST_ASSERT_EQUAL(1500, outputs.last("vibrate")->on);
    alerts.silence();
    TEST_ASSERT_TRUE(alerts.silenced());
    TEST_ASSERT_EQUAL(1u, outputs.count("buzz-stop"));
    clock.now = 59000;
    alerts.tick();
    TEST_ASSERT_EQUAL(1u, outputs.count("buzz"));
    clock.now = 61000;
    alerts.tick();
    TEST_ASSERT_EQUAL(2u, outputs.count("buzz"));
    // Silence only applies in danger.
    alerts.onLevel(Level::Caution);
    alerts.silence();
    TEST_ASSERT_FALSE(alerts.silenced());
}

void test_notice_double_vibration_and_blue_blink() {
    FakeClock clock;
    RecordingOutputs outputs;
    AlertController alerts(outputs, 60, true, true, clock.fn());
    alerts.onConnection(true);
    alerts.onNotice("critical");
    TEST_ASSERT_EQUAL(2, outputs.last("vibrate")->count);
    TEST_ASSERT_EQUAL(3, outputs.last("buzz")->count);
    TEST_ASSERT_EQUAL(LedColor::Blue, outputs.last("led")->color);
    TEST_ASSERT_TRUE(outputs.last("led")->blink);
    alerts.onNoticeCleared();
    TEST_ASSERT_EQUAL(LedColor::Green, outputs.last("led")->color);
    alerts.onNotice("info");
    TEST_ASSERT_EQUAL(1, outputs.last("buzz")->count);
}

void test_button_feedback_and_unmonitored_link() {
    FakeClock clock;
    RecordingOutputs outputs;
    AlertController alerts(outputs, 60, true, false, clock.fn());
    TEST_ASSERT_EQUAL(LedColor::Green, outputs.last("led")->color);
    alerts.onButton();
    TEST_ASSERT_EQUAL(60, outputs.last("vibrate")->on);
    // No button vibration while the danger alarm is running.
    alerts.onLevel(Level::Danger);
    size_t vibrations = outputs.count("vibrate");
    alerts.onButton();
    TEST_ASSERT_EQUAL(vibrations, outputs.count("vibrate"));
}

void test_pattern_timing() {
    Pattern forever{400, 400, -1, 1000};
    TEST_ASSERT_FALSE(forever.active(999));
    TEST_ASSERT_TRUE(forever.active(1000));
    TEST_ASSERT_FALSE(forever.active(1500));
    TEST_ASSERT_TRUE(forever.active(1800));
    Pattern once{150, 0, 1, 0};
    TEST_ASSERT_TRUE(once.active(149));
    TEST_ASSERT_FALSE(once.active(150));
    Pattern twice{250, 200, 2, 0};
    TEST_ASSERT_TRUE(twice.active(460));
    TEST_ASSERT_FALSE(twice.active(900));
}

void test_pattern_outputs_drive_levels() {
    FakeClock clock;
    PatternOutputs outputs(clock.fn());
    outputs.setLed(LedColor::Yellow, true);
    outputs.buzz(100, 0, 1);
    OutputLevels levels = outputs.levels(50);
    TEST_ASSERT_TRUE(levels.red && levels.green && !levels.blue);
    TEST_ASSERT_TRUE(levels.buzzer);
    TEST_ASSERT_FALSE(levels.motor);
    levels = outputs.levels(600);
    TEST_ASSERT_FALSE(levels.red || levels.green);
    TEST_ASSERT_FALSE(levels.buzzer);
    outputs.vibrate(1500, 3500, -1);
    TEST_ASSERT_TRUE(outputs.levels(10).motor);
    outputs.stopMotor();
    TEST_ASSERT_FALSE(outputs.levels(10).motor);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_classify_uses_hysteresis);
    RUN_TEST(test_level_changes_only_after_consecutive_samples);
    RUN_TEST(test_heat_group_combines_ambient_and_object);
    RUN_TEST(test_led_follows_link_and_level);
    RUN_TEST(test_danger_alarm_can_be_silenced_and_resumes);
    RUN_TEST(test_notice_double_vibration_and_blue_blink);
    RUN_TEST(test_button_feedback_and_unmonitored_link);
    RUN_TEST(test_pattern_timing);
    RUN_TEST(test_pattern_outputs_drive_levels);
    return UNITY_END();
}
