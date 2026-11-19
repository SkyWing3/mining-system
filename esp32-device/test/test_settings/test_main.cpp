// Configuración JSON (equivalente a la parte de configuración de tests/test_interface.py).
#include <unity.h>

#include "mining/settings.h"
#include "mining/url.h"

using namespace mining;

void setUp() {}
void tearDown() {}

static std::string patched(const std::string& patch) {
    std::string merged, error;
    TEST_ASSERT_TRUE_MESSAGE(mergeSettingsJson(defaultSettingsJson(), patch, merged, error), error.c_str());
    return merged;
}

static void expectInvalid(const std::string& patch, const char* fragment) {
    Settings settings;
    std::string error;
    TEST_ASSERT_FALSE_MESSAGE(parseSettings(patched(patch), settings, error), patch.c_str());
    TEST_ASSERT_TRUE_MESSAGE(error.find(fragment) != std::string::npos, error.c_str());
}

void test_default_config_loads() {
    Settings settings;
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(parseSettings(std::string(defaultSettingsJson()), settings, error), error.c_str());
    TEST_ASSERT_EQUAL(0x3C, settings.display.address);
    TEST_ASSERT_EQUAL(0x5A, settings.sensors.mlx90614.address);
    TEST_ASSERT_EQUAL(4, settings.sensors.co.pin);
    TEST_ASSERT_FALSE(settings.sensors.co.calibration.has_value());
    TEST_ASSERT_TRUE(settings.connection.has_value());
    // Without a credential the link is not configured, as in the Python version.
    TEST_ASSERT_FALSE(settings.linkConfigured());
    TEST_ASSERT_FALSE(settings.alerts.buzzerActiveHigh);
    TEST_ASSERT_EQUAL(16000, settings.voice.sampleRate);
}

void test_minimal_config_uses_defaults() {
    Settings settings;
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(parseSettings(std::string("{}"), settings, error), error.c_str());
    TEST_ASSERT_FALSE(settings.connection.has_value());
    TEST_ASSERT_EQUAL(5, settings.buttons.up);
    TEST_ASSERT_EQUAL(35, static_cast<int>(settings.alerts.coPpm.caution));
}

void test_configured_link_requires_wifi() {
    std::string key(64, 'a');
    expectInvalid("{\"connection\":{\"api_key\":\"" + key + "\"}}", "wifi.ssid");
    Settings settings;
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(parseSettings(patched("{\"wifi\":{\"ssid\":\"Mina\",\"password\":\"segura123\"},"
                                                   "\"connection\":{\"api_key\":\"" + key + "\"}}"),
                                           settings, error),
                             error.c_str());
    TEST_ASSERT_TRUE(settings.linkConfigured());
}

void test_duplicate_and_reserved_pins_rejected() {
    expectInvalid("{\"buttons\":{\"up\":6}}", "ya está en uso");
    expectInvalid("{\"alerts\":{\"motor\":{\"pin\":8}}}", "ya está en uso");
    expectInvalid("{\"buttons\":{\"enter\":19}}", "no disponible");
    expectInvalid("{\"alerts\":{\"buzzer\":{\"pin\":0}}}", "no disponible");
    expectInvalid("{\"voice\":{\"pins\":{\"sd\":35}}}", "no disponible");
    // ADC2 pins do not work with Wi-Fi.
    expectInvalid("{\"sensors\":{\"co\":{\"pin\":11}}}", "ADC1");
    // Disabled features free their pins.
    Settings settings;
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(parseSettings(patched("{\"voice\":{\"enabled\":false},\"buttons\":{\"up\":12}}"), settings, error),
                             error.c_str());
}

void test_invalid_values_rejected() {
    expectInvalid("{\"connection\":{\"api_key\":\"abc\"}}", "api_key");
    expectInvalid("{\"connection\":{\"heartbeat_seconds\":2}}", "heartbeat_seconds");
    expectInvalid("{\"connection\":{\"url\":\"wss://mina.example/ws/device\"}}", "wss://");
    expectInvalid("{\"connection\":{\"url\":\"ws://user:pw@mina/ws/device\"}}", "sin credenciales");
    expectInvalid("{\"alerts\":{\"thresholds\":{\"co_ppm\":{\"caution\":200,\"danger\":35}}}}", "caution");
    expectInvalid("{\"display\":{\"rotate\":1}}", "Rotación");
    expectInvalid("{\"display\":{\"address\":\"0x99\"}}", "dirección I2C");
    expectInvalid("{\"voice\":{\"sample_rate\":48000}}", "2 MB");
    expectInvalid("{\"voice\":{\"sample_rate\":12000}}", "sample_rate");
    expectInvalid("{\"voice\":{\"slot\":\"both\"}}", "voice.slot");
    expectInvalid("{\"sensors\":{\"co\":{\"samples\":1.5}}}", "co.samples");
    expectInvalid("{\"sensors\":{\"co\":{\"calibration\":{\"baseline_volts\":4,\"ppm_per_volt\":100}}}}", "3,3 V");
    expectInvalid("{\"alerts\":{\"enabled\":\"si\"}}", "true o false");
    expectInvalid("{\"i2c\":{\"frequency\":400000}}", "100000");
    expectInvalid("{\"wifi\":{\"password\":\"corta\"}}", "8 caracteres");
    Settings settings;
    std::string error;
    TEST_ASSERT_FALSE(parseSettings(std::string("[1,2]"), settings, error));
    TEST_ASSERT_FALSE(parseSettings(std::string("{"), settings, error));
}

void test_merge_keeps_other_keys_and_null_clears() {
    std::string merged = patched("{\"sensors\":{\"co\":{\"calibration\":{\"baseline_volts\":0.41,\"ppm_per_volt\":250}}}}");
    Settings settings;
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(parseSettings(merged, settings, error), error.c_str());
    TEST_ASSERT_TRUE(settings.sensors.co.calibration.has_value());
    TEST_ASSERT_DOUBLE_WITHIN(1e-6, 0.41, settings.sensors.co.calibration->baselineVolts);
    TEST_ASSERT_EQUAL(180, settings.sensors.co.warmupSeconds);
    TEST_ASSERT_TRUE(settings.sensors.mlx90614.enabled);
    std::string cleared;
    TEST_ASSERT_TRUE(mergeSettingsJson(merged, "{\"sensors\":{\"co\":{\"calibration\":null}}}", cleared, error));
    TEST_ASSERT_TRUE(parseSettings(cleared, settings, error));
    TEST_ASSERT_FALSE(settings.sensors.co.calibration.has_value());
}

void test_masked_secrets_are_hidden_and_never_written_back() {
    std::string withSecret = patched("{\"wifi\":{\"ssid\":\"Mina\",\"password\":\"secreta123\"}}");
    std::string shown = maskedSettingsJson(withSecret);
    TEST_ASSERT_TRUE(shown.find("secreta123") == std::string::npos);
    TEST_ASSERT_TRUE(shown.find(kMaskedSecret) != std::string::npos);
    // Pasting the masked document back keeps the real password.
    std::string merged, error;
    TEST_ASSERT_TRUE(mergeSettingsJson(withSecret, shown, merged, error));
    TEST_ASSERT_TRUE(merged.find("secreta123") != std::string::npos);
    // An empty password stays visible as empty.
    TEST_ASSERT_TRUE(maskedSettingsJson(defaultSettingsJson()).find(kMaskedSecret) == std::string::npos);
}

void test_central_url() {
    CentralUrl url;
    std::string error;
    TEST_ASSERT_TRUE(parseCentralUrl("ws://franco-rasp4.local/ws/device", url, error));
    TEST_ASSERT_EQUAL_STRING("franco-rasp4.local", url.host.c_str());
    TEST_ASSERT_EQUAL(80, url.port);
    TEST_ASSERT_EQUAL_STRING("/ws/device", url.path.c_str());
    TEST_ASSERT_EQUAL_STRING("/api/device/voice", url.voicePath().c_str());
    TEST_ASSERT_TRUE(parseCentralUrl("ws://192.168.1.20:5080/mina/ws/device?x=1", url, error));
    TEST_ASSERT_EQUAL(5080, url.port);
    TEST_ASSERT_EQUAL_STRING("/mina/api/device/voice", url.voicePath().c_str());
    TEST_ASSERT_FALSE(parseCentralUrl("http://mina/ws/device", url, error));
    TEST_ASSERT_FALSE(parseCentralUrl("ws://mina:99999/ws/device", url, error));
    TEST_ASSERT_FALSE(parseCentralUrl("ws:///ws/device", url, error));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_default_config_loads);
    RUN_TEST(test_minimal_config_uses_defaults);
    RUN_TEST(test_configured_link_requires_wifi);
    RUN_TEST(test_duplicate_and_reserved_pins_rejected);
    RUN_TEST(test_invalid_values_rejected);
    RUN_TEST(test_merge_keeps_other_keys_and_null_clears);
    RUN_TEST(test_masked_secrets_are_hidden_and_never_written_back);
    RUN_TEST(test_central_url);
    return UNITY_END();
}
