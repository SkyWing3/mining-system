#include "mining/settings.h"

#include <cctype>
#include <cmath>
#include <cstdlib>
#include <set>
#include <utility>
#include <vector>

#include "mining/url.h"

namespace mining {

namespace {

const char kDefaults[] = R"json({
  "wifi": {"ssid": "", "password": ""},
  "i2c": {"sda": 8, "scl": 9, "frequency": 100000},
  "display": {"address": "0x3C", "rotate": 0},
  "buttons": {"up": 5, "down": 6, "enter": 7, "bounce_seconds": 0.08},
  "connection": {
    "url": "ws://franco-rasp4.local/ws/device",
    "api_key": "",
    "heartbeat_seconds": 20,
    "telemetry_seconds": 2
  },
  "sensors": {
    "sample_seconds": 1,
    "simulated": false,
    "co": {"enabled": true, "pin": 4, "samples": 16, "warmup_seconds": 180, "calibration": null},
    "mlx90614": {"enabled": true, "address": "0x5A"}
  },
  "alerts": {
    "enabled": true,
    "led": {"red": 15, "green": 16, "blue": 17, "active_high": true},
    "buzzer": {"pin": 18, "active_high": false},
    "motor": {"pin": 10},
    "button_feedback": true,
    "silence_seconds": 60,
    "confirm_samples": 3,
    "thresholds": {
      "co_ppm": {"caution": 35, "danger": 200},
      "ambient_c": {"caution": 32, "danger": 38},
      "object_c": {"caution": 60, "danger": 90}
    }
  },
  "voice": {
    "enabled": true,
    "pins": {"sck": 12, "ws": 13, "sd": 14},
    "slot": "left",
    "sample_rate": 16000,
    "max_seconds": 30,
    "max_pending": 20
  }
})json";

const int kSampleRates[] = {8000, 16000, 22050, 32000, 44100, 48000};

// Collects the first validation error; every reader returns false once it fails.
class Reader {
public:
    std::string error;

    bool fail(const std::string& message) {
        if (error.empty()) error = message;
        return false;
    }

    // Missing or null values keep the default.
    bool integer(JsonVariantConst value, const char* name, long low, long high, int& out) {
        if (value.isNull()) return true;
        if (!value.is<long>() || value.as<long>() < low || value.as<long>() > high)
            return fail(std::string(name) + " debe ser un entero entre " + std::to_string(low) + " y " + std::to_string(high) + ".");
        out = static_cast<int>(value.as<long>());
        return true;
    }

    bool number(JsonVariantConst value, const char* name, double& out) {
        if (value.isNull()) return true;
        if (value.is<bool>() || !value.is<double>() || !std::isfinite(value.as<double>()))
            return fail(std::string(name) + " debe ser un número.");
        out = value.as<double>();
        return true;
    }

    bool flag(JsonVariantConst value, const char* name, bool& out) {
        if (value.isNull()) return true;
        if (!value.is<bool>()) return fail(std::string(name) + " debe ser true o false.");
        out = value.as<bool>();
        return true;
    }

    bool text(JsonVariantConst value, const char* name, size_t maxLength, std::string& out) {
        if (value.isNull()) return true;
        if (!value.is<const char*>()) return fail(std::string(name) + " debe ser un texto.");
        std::string result = value.as<const char*>();
        if (result.size() > maxLength) return fail(std::string(name) + " es demasiado largo.");
        out = result;
        return true;
    }

    bool address(JsonVariantConst value, const char* name, uint8_t& out) {
        if (value.isNull()) return true;
        long parsed = -1;
        if (value.is<const char*>()) {
            const char* raw = value.as<const char*>();
            char* end = nullptr;
            parsed = std::strtol(raw, &end, 0);
            if (*raw == '\0' || *end != '\0') parsed = -1;
        } else if (value.is<long>()) {
            parsed = value.as<long>();
        }
        if (parsed < 0x08 || parsed > 0x77) return fail(std::string(name) + ": dirección I2C inválida.");
        out = static_cast<uint8_t>(parsed);
        return true;
    }

    bool object(JsonVariantConst value, const char* name) {
        if (value.isNull() || value.is<JsonObjectConst>()) return true;
        return fail(std::string(name) + " debe ser un objeto JSON.");
    }

    bool threshold(JsonVariantConst value, const char* name, Threshold& out) {
        if (value.isNull()) return true;
        if (!object(value, name)) return false;
        double caution = NAN, danger = NAN;
        std::string prefix = std::string("thresholds.") + name;
        if (value["caution"].isNull() || value["danger"].isNull())
            return fail(prefix + " necesita caution y danger.");
        if (!number(value["caution"], (prefix + ".caution").c_str(), caution) ||
            !number(value["danger"], (prefix + ".danger").c_str(), danger))
            return false;
        if (caution >= danger) return fail(prefix + ": caution debe ser menor que danger.");
        out = {caution, danger};
        return true;
    }
};

bool readWifi(Reader& r, JsonVariantConst data, WifiConfig& out) {
    if (!r.object(data, "wifi")) return false;
    if (!r.text(data["ssid"], "wifi.ssid", 32, out.ssid) || !r.text(data["password"], "wifi.password", 64, out.password))
        return false;
    if (!out.password.empty() && out.password.size() < 8)
        return r.fail("wifi.password debe tener al menos 8 caracteres (WPA2) o quedar vacía para una red abierta.");
    return true;
}

bool readI2c(Reader& r, JsonVariantConst data, I2cConfig& out) {
    if (!r.object(data, "i2c")) return false;
    int frequency = static_cast<int>(out.frequency);
    if (!r.integer(data["sda"], "i2c.sda", 0, 48, out.sda) || !r.integer(data["scl"], "i2c.scl", 0, 48, out.scl) ||
        !r.integer(data["frequency"], "i2c.frequency", 10000, 400000, frequency))
        return false;
    out.frequency = static_cast<uint32_t>(frequency);
    return true;
}

bool readDisplay(Reader& r, JsonVariantConst data, DisplayConfig& out) {
    if (!r.object(data, "display")) return false;
    if (!r.address(data["address"], "display.address", out.address) || !r.integer(data["rotate"], "display.rotate", 0, 2, out.rotate))
        return false;
    if (out.rotate != 0 && out.rotate != 2) return r.fail("Rotación distinta de 0/2 (128x64).");
    return true;
}

bool readButtons(Reader& r, JsonVariantConst data, ButtonsConfig& out) {
    if (!r.object(data, "buttons")) return false;
    if (!r.integer(data["up"], "buttons.up", 0, 48, out.up) || !r.integer(data["down"], "buttons.down", 0, 48, out.down) ||
        !r.integer(data["enter"], "buttons.enter", 0, 48, out.enter) ||
        !r.number(data["bounce_seconds"], "buttons.bounce_seconds", out.bounceSeconds))
        return false;
    if (!(out.bounceSeconds > 0 && out.bounceSeconds <= 1)) return r.fail("bounce_seconds debe estar entre 0 y 1 segundo.");
    return true;
}

bool readConnection(Reader& r, JsonVariantConst data, ConnectionConfig& out) {
    if (!r.object(data, "connection")) return false;
    if (!r.text(data["url"], "connection.url", 200, out.url) || !r.text(data["api_key"], "connection.api_key", 64, out.apiKey))
        return false;
    CentralUrl url;
    std::string urlError;
    if (!parseCentralUrl(out.url, url, urlError)) return r.fail(urlError);
    if (!out.apiKey.empty()) {
        bool hex = out.apiKey.size() == 64;
        for (char c : out.apiKey) hex = hex && std::isxdigit(static_cast<unsigned char>(c));
        if (!hex) return r.fail("api_key debe ser la credencial de 64 caracteres de la central.");
    }
    if (!r.number(data["heartbeat_seconds"], "connection.heartbeat_seconds", out.heartbeatSeconds) ||
        !r.number(data["telemetry_seconds"], "connection.telemetry_seconds", out.telemetrySeconds))
        return false;
    if (!(out.heartbeatSeconds >= 5 && out.heartbeatSeconds <= 30)) return r.fail("heartbeat_seconds debe estar entre 5 y 30.");
    if (!(out.telemetrySeconds >= 1 && out.telemetrySeconds <= 30)) return r.fail("telemetry_seconds debe estar entre 1 y 30.");
    return true;
}

bool readSensors(Reader& r, JsonVariantConst data, SensorsConfig& out) {
    if (!r.object(data, "sensors")) return false;
    if (!r.number(data["sample_seconds"], "sensors.sample_seconds", out.sampleSeconds) ||
        !r.flag(data["simulated"], "sensors.simulated", out.simulated))
        return false;
    if (!(out.sampleSeconds >= 0.2 && out.sampleSeconds <= 10)) return r.fail("sensors.sample_seconds debe estar entre 0,2 y 10.");

    JsonVariantConst co = data["co"];
    if (!r.object(co, "sensors.co") || !r.flag(co["enabled"], "co.enabled", out.co.enabled) ||
        !r.integer(co["pin"], "co.pin", 0, 48, out.co.pin) || !r.integer(co["samples"], "co.samples", 1, 64, out.co.samples) ||
        !r.integer(co["warmup_seconds"], "co.warmup_seconds", 0, 3600, out.co.warmupSeconds))
        return false;
    JsonVariantConst calibration = co["calibration"];
    if (!calibration.isNull()) {
        if (!r.object(calibration, "co.calibration")) return false;
        double baseline = NAN, slope = NAN;
        if (calibration["baseline_volts"].isNull() || calibration["ppm_per_volt"].isNull())
            return r.fail("co.calibration necesita baseline_volts y ppm_per_volt.");
        if (!r.number(calibration["baseline_volts"], "co.calibration.baseline_volts", baseline) ||
            !r.number(calibration["ppm_per_volt"], "co.calibration.ppm_per_volt", slope))
            return false;
        if (!(baseline >= 0 && baseline <= 3.3) || !(slope > 0))
            return r.fail("La calibración de CO requiere baseline_volts entre 0 y 3,3 V y ppm_per_volt positivo.");
        out.co.calibration = CoCalibration{baseline, slope};
    } else {
        out.co.calibration.reset();
    }

    JsonVariantConst mlx = data["mlx90614"];
    return r.object(mlx, "sensors.mlx90614") && r.flag(mlx["enabled"], "mlx90614.enabled", out.mlx90614.enabled) &&
           r.address(mlx["address"], "mlx90614.address", out.mlx90614.address);
}

bool readAlerts(Reader& r, JsonVariantConst data, AlertsConfig& out) {
    if (!r.object(data, "alerts")) return false;
    JsonVariantConst led = data["led"], buzzer = data["buzzer"], motor = data["motor"], thresholds = data["thresholds"];
    return r.object(led, "alerts.led") && r.object(buzzer, "alerts.buzzer") && r.object(motor, "alerts.motor") &&
           r.object(thresholds, "alerts.thresholds") && r.flag(data["enabled"], "alerts.enabled", out.enabled) &&
           r.integer(led["red"], "led.red", 0, 48, out.ledRed) && r.integer(led["green"], "led.green", 0, 48, out.ledGreen) &&
           r.integer(led["blue"], "led.blue", 0, 48, out.ledBlue) &&
           r.flag(led["active_high"], "led.active_high", out.ledActiveHigh) &&
           r.integer(buzzer["pin"], "buzzer.pin", 0, 48, out.buzzerPin) &&
           r.flag(buzzer["active_high"], "buzzer.active_high", out.buzzerActiveHigh) &&
           r.integer(motor["pin"], "motor.pin", 0, 48, out.motorPin) &&
           r.flag(data["button_feedback"], "alerts.button_feedback", out.buttonFeedback) &&
           r.integer(data["silence_seconds"], "alerts.silence_seconds", 5, 600, out.silenceSeconds) &&
           r.integer(data["confirm_samples"], "alerts.confirm_samples", 1, 30, out.confirmSamples) &&
           r.threshold(thresholds["co_ppm"], "co_ppm", out.coPpm) &&
           r.threshold(thresholds["ambient_c"], "ambient_c", out.ambientC) &&
           r.threshold(thresholds["object_c"], "object_c", out.objectC);
}

bool readVoice(Reader& r, JsonVariantConst data, VoiceConfig& out) {
    if (!r.object(data, "voice")) return false;
    JsonVariantConst pins = data["pins"];
    std::string slot = out.rightSlot ? "right" : "left";
    if (!r.object(pins, "voice.pins") || !r.flag(data["enabled"], "voice.enabled", out.enabled) ||
        !r.integer(pins["sck"], "voice.pins.sck", 0, 48, out.sck) || !r.integer(pins["ws"], "voice.pins.ws", 0, 48, out.ws) ||
        !r.integer(pins["sd"], "voice.pins.sd", 0, 48, out.sd) || !r.text(data["slot"], "voice.slot", 8, slot) ||
        !r.integer(data["sample_rate"], "voice.sample_rate", 8000, 48000, out.sampleRate) ||
        !r.integer(data["max_seconds"], "voice.max_seconds", 1, 60, out.maxSeconds) ||
        !r.integer(data["max_pending"], "voice.max_pending", 1, 200, out.maxPending))
        return false;
    if (slot != "left" && slot != "right") return r.fail("voice.slot debe ser \"left\" o \"right\".");
    out.rightSlot = slot == "right";
    bool knownRate = false;
    for (int rate : kSampleRates) knownRate = knownRate || rate == out.sampleRate;
    if (!knownRate) return r.fail("voice.sample_rate debe ser 8000, 16000, 22050, 32000, 44100 o 48000.");
    if (static_cast<int64_t>(out.sampleRate) * out.maxSeconds * 2 + 44 > kMaxVoiceBytes)
        return r.fail("voice: sample_rate x max_seconds supera los 2 MB que acepta la central.");
    return true;
}

bool validatePins(Reader& r, const Settings& s) {
    std::vector<std::pair<const char*, int>> pins = {
        {"i2c.sda", s.i2c.sda}, {"i2c.scl", s.i2c.scl},
        {"buttons.up", s.buttons.up}, {"buttons.down", s.buttons.down}, {"buttons.enter", s.buttons.enter},
    };
    if (s.alerts.enabled) {
        pins.insert(pins.end(), {{"led.red", s.alerts.ledRed}, {"led.green", s.alerts.ledGreen}, {"led.blue", s.alerts.ledBlue},
                                 {"buzzer.pin", s.alerts.buzzerPin}, {"motor.pin", s.alerts.motorPin}});
    }
    if (s.sensors.co.enabled && !s.sensors.simulated) {
        if (!isAdc1Gpio(s.sensors.co.pin))
            return r.fail("co.pin debe ser un GPIO con ADC1 (1 a 10): el ADC2 no funciona con el Wi-Fi activo.");
        pins.push_back({"co.pin", s.sensors.co.pin});
    }
    if (s.voice.enabled) {
        pins.insert(pins.end(), {{"voice.pins.sck", s.voice.sck}, {"voice.pins.ws", s.voice.ws}, {"voice.pins.sd", s.voice.sd}});
    }
    std::set<int> used;
    for (const auto& [name, pin] : pins) {
        if (!isUsableGpio(pin))
            return r.fail(std::string(name) + ": GPIO " + std::to_string(pin) +
                          " no disponible (evita 0, 3, 19, 20, 26-37, 38, 43-46 y 48).");
        if (!used.insert(pin).second) return r.fail(std::string(name) + ": GPIO " + std::to_string(pin) + " ya está en uso.");
    }
    return true;
}

void merge(JsonVariant dst, JsonVariantConst src) {
    if (src.is<JsonObjectConst>()) {
        if (!dst.is<JsonObject>()) dst.to<JsonObject>();
        for (JsonPairConst member : src.as<JsonObjectConst>()) {
            if (member.value().is<JsonObjectConst>()) {
                JsonVariant child = dst[member.key()];
                if (!child.is<JsonObject>()) dst[member.key()].to<JsonObject>();
                merge(dst[member.key()], member.value());
            } else {
                dst[member.key()] = member.value();
            }
        }
    } else {
        dst.set(src);
    }
}

// Removes a masked secret from the patch so it never replaces the stored value.
void dropMasked(JsonVariant patch, const char* section, const char* key) {
    JsonVariant value = patch[section][key];
    if (value.is<const char*>() && std::string(value.as<const char*>()) == kMaskedSecret) patch[section].remove(key);
}

}  // namespace

const char* defaultSettingsJson() { return kDefaults; }

bool isUsableGpio(int pin) {
    // 0, 3, 45, 46: strapping; 19, 20: USB; 26-37: flash/PSRAM; 38 and 48: on-board RGB LED; 43, 44: UART0 console.
    static const int usable[] = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 39, 40, 41, 42, 47};
    for (int candidate : usable) {
        if (candidate == pin) return true;
    }
    return false;
}

bool isAdc1Gpio(int pin) { return pin >= 1 && pin <= 10; }

bool parseSettings(JsonVariantConst root, Settings& out, std::string& error) {
    Reader r;
    Settings s;
    if (!root.is<JsonObjectConst>()) {
        error = "La configuración debe ser un objeto JSON.";
        return false;
    }
    bool ok = readWifi(r, root["wifi"], s.wifi) && readI2c(r, root["i2c"], s.i2c) && readDisplay(r, root["display"], s.display) &&
              readButtons(r, root["buttons"], s.buttons) && readSensors(r, root["sensors"], s.sensors) &&
              readAlerts(r, root["alerts"], s.alerts) && readVoice(r, root["voice"], s.voice);
    if (ok && !root["connection"].isNull()) {
        ConnectionConfig connection;
        ok = readConnection(r, root["connection"], connection);
        if (ok) s.connection = connection;
    }
    if (ok && s.linkConfigured() && s.wifi.ssid.empty()) ok = r.fail("wifi.ssid es obligatorio para conectar con la central.");
    if (ok && s.sensors.mlx90614.enabled && s.i2c.frequency > 100000)
        ok = r.fail("i2c.frequency: el MLX90614 admite como máximo 100000 Hz.");
    if (ok && s.sensors.mlx90614.enabled && s.sensors.mlx90614.address == s.display.address)
        ok = r.fail("La OLED y el MLX90614 necesitan direcciones I2C distintas.");
    ok = ok && validatePins(r, s);
    if (!ok) {
        error = r.error;
        return false;
    }
    out = s;
    return true;
}

bool parseSettings(const std::string& json, Settings& out, std::string& error) {
    JsonDocument document;
    DeserializationError result = deserializeJson(document, json);
    if (result) {
        error = std::string("JSON inválido: ") + result.c_str();
        return false;
    }
    return parseSettings(document.as<JsonVariantConst>(), out, error);
}

bool mergeSettingsJson(const std::string& current, const std::string& patch, std::string& merged, std::string& error) {
    JsonDocument base, changes;
    if (DeserializationError result = deserializeJson(base, current)) {
        error = std::string("Configuración guardada inválida: ") + result.c_str();
        return false;
    }
    if (DeserializationError result = deserializeJson(changes, patch)) {
        error = std::string("JSON inválido: ") + result.c_str();
        return false;
    }
    if (!changes.is<JsonObject>()) {
        error = "El cambio debe ser un objeto JSON.";
        return false;
    }
    dropMasked(changes.as<JsonVariant>(), "wifi", "password");
    dropMasked(changes.as<JsonVariant>(), "connection", "api_key");
    if (!base.is<JsonObject>()) base.to<JsonObject>();
    merge(base.as<JsonVariant>(), changes.as<JsonVariantConst>());
    merged.clear();
    serializeJson(base, merged);
    return true;
}

std::string maskedSettingsJson(const std::string& json) {
    JsonDocument document;
    if (deserializeJson(document, json)) return json;
    for (const auto& [section, key] : {std::make_pair("wifi", "password"), std::make_pair("connection", "api_key")}) {
        JsonVariant value = document[section][key];
        if (value.is<const char*>() && *value.as<const char*>() != '\0') value.set(kMaskedSecret);
    }
    std::string out;
    serializeJsonPretty(document, out);
    return out;
}

}  // namespace mining
