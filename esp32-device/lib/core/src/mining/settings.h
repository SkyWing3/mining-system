// Configuración JSON validada (equivalente a device/src/config.py).
//
// Los pines son GPIO del ESP32-S3. A diferencia de la versión para Raspberry Pi,
// el bus I2C y el I2S del micrófono también se configuran aquí, y el SEN0564 se
// lee con el ADC interno (ADC1), sin ADS1115.
#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <optional>
#include <string>

namespace mining {

struct Threshold {
    double caution;
    double danger;
};

struct CoCalibration {
    double baselineVolts;
    double ppmPerVolt;

    double ppm(double volts) const {
        double value = (volts - baselineVolts) * ppmPerVolt;
        return value > 0 ? value : 0.0;
    }
};

struct WifiConfig {
    std::string ssid;
    std::string password;
};

struct I2cConfig {
    int sda = 8;
    int scl = 9;
    // El MLX90614 admite como máximo 100 kHz (SMBus).
    uint32_t frequency = 100000;
};

struct DisplayConfig {
    uint8_t address = 0x3C;
    int rotate = 0;
};

struct ButtonsConfig {
    int up = 5;
    int down = 6;
    int enter = 7;
    double bounceSeconds = 0.08;
};

struct ConnectionConfig {
    std::string url;
    std::string apiKey;
    double heartbeatSeconds = 20;
    double telemetrySeconds = 2;

    bool configured() const { return !apiKey.empty(); }
};

struct CoConfig {
    bool enabled = true;
    int pin = 4;
    int samples = 16;
    int warmupSeconds = 180;
    std::optional<CoCalibration> calibration;
};

struct ThermometerConfig {
    bool enabled = true;
    uint8_t address = 0x5A;
};

struct SensorsConfig {
    double sampleSeconds = 1.0;
    // Lecturas sintéticas marcadas como simuladas, para demostraciones sin sensores.
    bool simulated = false;
    CoConfig co;
    ThermometerConfig mlx90614;
};

struct AlertsConfig {
    bool enabled = true;
    int ledRed = 15;
    int ledGreen = 16;
    int ledBlue = 17;
    bool ledActiveHigh = true;
    int buzzerPin = 18;
    bool buzzerActiveHigh = false;
    int motorPin = 10;
    bool buttonFeedback = true;
    int silenceSeconds = 60;
    int confirmSamples = 3;
    Threshold coPpm{35, 200};
    Threshold ambientC{32, 38};
    Threshold objectC{60, 90};
};

struct VoiceConfig {
    bool enabled = true;
    // Columna derecha de la DevKitC (J3), frente al conector del micrófono en la placa.
    int sck = 41;
    int ws = 42;
    int sd = 40;
    // Canal I2S donde el INMP441 entrega los datos (L/R a GND: izquierdo).
    bool rightSlot = false;
    int sampleRate = 16000;
    int maxSeconds = 30;
    int maxPending = 20;
};

struct Settings {
    WifiConfig wifi;
    I2cConfig i2c;
    DisplayConfig display;
    ButtonsConfig buttons;
    std::optional<ConnectionConfig> connection;
    SensorsConfig sensors;
    AlertsConfig alerts;
    VoiceConfig voice;

    // Enlace con la central: requiere credencial (y por validación, Wi-Fi).
    bool linkConfigured() const { return connection && connection->configured(); }
};

// Tamaño máximo de audio que acepta la central (Mining:Voice:MaxBytes).
constexpr int64_t kMaxVoiceBytes = 2 * 1024 * 1024;
// Valor que muestra la consola en lugar de las credenciales.
constexpr const char* kMaskedSecret = "********";

// Documento JSON con la configuración por defecto (igual a config/settings.example.json).
const char* defaultSettingsJson();

// Valida el documento completo; en caso de error devuelve false y un mensaje en español.
bool parseSettings(JsonVariantConst root, Settings& out, std::string& error);
bool parseSettings(const std::string& json, Settings& out, std::string& error);

// Combina `patch` sobre `current` (objetos anidados se combinan; null borra el valor).
// Las credenciales enmascaradas en el parche se ignoran para no sobrescribirlas.
bool mergeSettingsJson(const std::string& current, const std::string& patch, std::string& merged, std::string& error);

// JSON con formato legible y las credenciales ocultas, para la consola.
std::string maskedSettingsJson(const std::string& json);

// GPIO utilizables en la ESP32-S3 DevKitC (sin pines de arranque, USB, flash/PSRAM ni UART0).
bool isUsableGpio(int pin);
// GPIO con ADC1 (el ADC2 no funciona con el Wi-Fi activo).
bool isAdc1Gpio(int pin);

}  // namespace mining
