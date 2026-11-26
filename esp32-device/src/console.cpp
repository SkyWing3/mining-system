#include "console.h"

#include <Arduino.h>
#include <WiFi.h>

#include <algorithm>
#include <cstdlib>

#include "hardware.h"
#include "mining/log.h"
#include "network.h"
#include "serial_io.h"
#include "storage.h"

namespace device {

namespace {
constexpr size_t kMaxLine = 4096;
// The SEN0564 is powered from the 3V3 rail.
constexpr double kSensorSupplyVolts = 3.3;
// Max-min spread, relative to the mean, accepted as a stable baseline.
constexpr double kStableVariationPercent = 5.0;

bool startsWith(const std::string& value, const char* prefix) { return value.rfind(prefix, 0) == 0; }

std::string trim(const std::string& value) {
    size_t first = value.find_first_not_of(" \t");
    if (first == std::string::npos) return "";
    return value.substr(first, value.find_last_not_of(" \t") - first + 1);
}

void print(const std::string& text) { serialWrite((text + "\r\n").c_str()); }

std::string optionalNumber(const std::optional<double>& value, const char* format) {
    if (!value) return "--";
    char buffer[24];
    snprintf(buffer, sizeof buffer, format, *value);
    return buffer;
}
}  // namespace

std::string loadSettingsJson(mining::FileStore& store) {
    std::string json;
    if (store.read(kSettingsPath, json) && !json.empty()) return json;
    return mining::defaultSettingsJson();
}

void Console::begin() { xTaskCreatePinnedToCore(entry, "mining-console", 8192, this, 1, nullptr, 1); }

void Console::entry(void* self) { static_cast<Console*>(self)->run(); }

void Console::run() {
    // One line buffer per connector, so input from both never mixes.
    std::string lines[kConsoleStreams];
    print("Consola de la manilla lista. Escribe help para ver los comandos.");
    for (;;) {
        for (size_t index = 0; index < kConsoleStreams; ++index) {
            Stream& stream = consoleStream(index);
            std::string& line = lines[index];
            while (stream.available() > 0) {
                int c = stream.read();
                if (c == '\r' || c == '\n') {
                    std::string command = trim(line);
                    line.clear();
                    if (!command.empty()) execute(command);
                } else if ((c == 8 || c == 127) && !line.empty()) {
                    line.pop_back();
                } else if (c >= 0 && line.size() < kMaxLine) {
                    line += static_cast<char>(c);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void Console::execute(const std::string& line) {
    if (line == "help" || line == "?") {
        help();
    } else if (line == "status") {
        status();
    } else if (line == "config") {
        print(mining::maskedSettingsJson(ctx_.settingsJson));
        if (!ctx_.configError.empty()) print("Configuración inválida: " + ctx_.configError);
    } else if (startsWith(line, "config set ")) {
        configSet(trim(line.substr(11)));
    } else if (line == "config reset") {
        ctx_.store->remove(kSettingsPath);
        print("Configuración de fábrica restaurada. Reiniciando...");
        delay(200);
        ESP.restart();
    } else if (startsWith(line, "calibrate ")) {
        calibrate(trim(line.substr(10)));
    } else if (line == "simulate gas" || line == "simulate heat") {
        if (ctx_.simulated == nullptr) {
            print("Solo disponible con \"sensors\": {\"simulated\": true}.");
        } else if (line == "simulate gas") {
            ctx_.simulated->spikeGas();
            print("Pico de CO simulado durante 25 s.");
        } else {
            ctx_.simulated->spikeHeat();
            print("Pico de calor simulado durante 25 s.");
        }
    } else if (line == "i2c scan") {
        i2cScan();
    } else if (line == "test outputs") {
        testOutputs();
    } else if (startsWith(line, "test buttons")) {
        int seconds = atoi(trim(line.substr(12)).c_str());
        testButtons(seconds > 0 ? seconds : 30);
    } else if (line == "restart") {
        print("Reiniciando...");
        delay(200);
        ESP.restart();
    } else {
        print("Comando desconocido. Escribe help.");
    }
}

void Console::help() {
    print("Comandos:");
    print("  status                              Wi-Fi, central, colas, sensores y memoria");
    print("  config                              configuración actual (credenciales ocultas)");
    print("  config set {json}                   combina el JSON, lo valida, lo guarda y reinicia");
    print("                                      p. ej. config set {\"wifi\":{\"ssid\":\"Mina\",\"password\":\"...\"}}");
    print("  config reset                        vuelve a la configuración de fábrica");
    print("  calibrate co baseline [segundos]    línea base en aire limpio (60 s por defecto)");
    print("  calibrate co reference <ppm> [s]    con gas de referencia; guarda la calibración");
    print("  calibrate co estimate [s]           estimación provisional sin gas (hoja de datos), solo demostración");
    print("  calibrate co clear                  borra la calibración (vuelve a informar voltios)");
    print("  simulate gas | simulate heat        picos de prueba con sensores simulados");
    print("  i2c scan                            dispositivos del bus I2C (OLED 0x3C, MLX90614 0x5A)");
    print("  test outputs                        LED rojo/verde/azul, buzzer y motor, uno por uno");
    print("  test buttons [segundos]             muestra cada pulsación (30 s por defecto)");
    print("  restart                             reinicia la manilla");
}

void Console::status() {
    char buffer[160];
    if (!ctx_.configError.empty()) print("MODO SEGURO, configuración inválida: " + ctx_.configError);
    if (WiFi.status() == WL_CONNECTED) {
        snprintf(buffer, sizeof buffer, "Wi-Fi: %s, IP %s, %d dBm", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        snprintf(buffer, sizeof buffer, "Wi-Fi: sin conexión");
    }
    print(buffer);
    if (ctx_.link == nullptr) {
        print("Central: sin configurar (falta connection.api_key)");
    } else {
        print(std::string("Central: ") + (ctx_.link->connected() ? "conectada" : "sin enlace") +
              (ctx_.link->lastError().empty() ? "" : " (último error: " + ctx_.link->lastError() + ")"));
    }
    if (ctx_.clock != nullptr) {
        std::optional<int64_t> now = ctx_.clock->now();
        print("Hora: " + (now ? mining::formatIso(*now) : std::string("sin sincronizar")) + ", arranque " +
              std::to_string(ctx_.clock->bootId()));
    }
    if (ctx_.outbox != nullptr) {
        snprintf(buffer, sizeof buffer, "Cola de mensajes: %u pendientes (%u mensajes)", static_cast<unsigned>(ctx_.outbox->pending()),
                 static_cast<unsigned>(ctx_.outbox->pendingMessages()));
        print(buffer);
    }
    if (ctx_.voices != nullptr) {
        snprintf(buffer, sizeof buffer, "Cola de voz: %d de %d", ctx_.voices->pending(), ctx_.voices->maxPending());
        print(buffer);
    }
    if (ctx_.hub != nullptr) {
        std::optional<mining::MonitorUpdate> update = ctx_.hub->latest();
        if (update) {
            const mining::SensorSnapshot& s = update->snapshot;
            print("Sensores" + std::string(s.simulated ? " (simulados)" : "") + ": ambiente " + optionalNumber(s.ambientC, "%.2f C") +
                  ", objeto " + optionalNumber(s.objectC, "%.2f C") + ", CO " + optionalNumber(s.coVolts, "%.4f V") + " / " +
                  optionalNumber(s.coPpm, "%.0f ppm") + ", nivel " + mining::levelLabel(update->assessment.level));
            if (s.coState == mining::CoState::Warming) print("CO en precalentamiento: " + std::to_string(s.warmupRemaining) + " s");
        }
    }
    snprintf(buffer, sizeof buffer, "Flash: %u KB libres de %u KB; RAM libre %u KB (mínimo %u KB)",
             static_cast<unsigned>(storageFreeBytes() / 1024), static_cast<unsigned>(storageTotalBytes() / 1024),
             static_cast<unsigned>(ESP.getFreeHeap() / 1024), static_cast<unsigned>(ESP.getMinFreeHeap() / 1024));
    print(buffer);
    snprintf(buffer, sizeof buffer, "Encendida hace %lu s", static_cast<unsigned long>(uptimeMs() / 1000));
    print(buffer);
}

void Console::i2cScan() {
    std::vector<uint8_t> found = scanI2c();
    if (found.empty()) {
        print("I2C: ningún dispositivo responde. Revisa SDA, SCL, 3V3 y GND.");
        return;
    }
    for (uint8_t address : found) {
        const char* name = "desconocido";
        if (ctx_.settings != nullptr && address == ctx_.settings->display.address) name = "OLED SSD1306";
        if (ctx_.settings != nullptr && address == ctx_.settings->sensors.mlx90614.address) name = "MLX90614";
        char buffer[64];
        snprintf(buffer, sizeof buffer, "I2C 0x%02X: %s", address, name);
        print(buffer);
    }
}

void Console::testOutputs() {
    if (ctx_.outputs == nullptr || ctx_.settings == nullptr || !ctx_.settings->alerts.enabled) {
        print("Las salidas de alerta están desactivadas.");
        return;
    }
    mining::LedColor previousColor = ctx_.outputs->ledColor();
    bool previousBlink = ctx_.outputs->ledBlink();
    const struct {
        mining::LedColor color;
        const char* text;
    } colors[] = {{mining::LedColor::Red, "LED rojo"}, {mining::LedColor::Green, "LED verde"}, {mining::LedColor::Blue, "LED azul"}};
    for (const auto& step : colors) {
        print(step.text);
        ctx_.outputs->setLed(step.color, false);
        delay(1500);
    }
    ctx_.outputs->setLed(mining::LedColor::Off, false);
    print("Buzzer: dos pitidos");
    ctx_.outputs->buzz(300, 300, 2);
    delay(1500);
    print("Motor: una vibración");
    ctx_.outputs->vibrate(800, 0, 1);
    delay(1500);
    ctx_.outputs->setLed(previousColor, previousBlink);
    print("Prueba de salidas terminada.");
}

void Console::testButtons(int seconds) {
    const struct {
        mining::Action action;
        const char* name;
        int pin;
    } buttons[] = {{mining::Action::Up, "SUBIR", ctx_.settings ? ctx_.settings->buttons.up : -1},
                   {mining::Action::Down, "BAJAR", ctx_.settings ? ctx_.settings->buttons.down : -1},
                   {mining::Action::Enter, "ENTER", ctx_.settings ? ctx_.settings->buttons.enter : -1}};
    uint32_t start[3], seen[3];
    for (int i = 0; i < 3; ++i) start[i] = seen[i] = buttonPresses(buttons[i].action);
    print("Presiona los botones durante " + std::to_string(seconds) + " s...");
    mining::Millis end = uptimeMs() + static_cast<mining::Millis>(seconds) * 1000;
    while (uptimeMs() < end) {
        for (int i = 0; i < 3; ++i) {
            uint32_t now = buttonPresses(buttons[i].action);
            for (; seen[i] < now; ++seen[i]) print(std::string("Botón ") + buttons[i].name + " (GPIO " + std::to_string(buttons[i].pin) + ")");
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    char summary[96];
    snprintf(summary, sizeof summary, "Resumen: SUBIR %u, BAJAR %u, ENTER %u pulsaciones.", static_cast<unsigned>(seen[0] - start[0]),
             static_cast<unsigned>(seen[1] - start[1]), static_cast<unsigned>(seen[2] - start[2]));
    print(summary);
}

void Console::configSet(const std::string& patch) {
    if (save(patch)) {
        print("Configuración guardada. Reiniciando...");
        delay(200);
        ESP.restart();
    }
}

bool Console::save(const std::string& patch) {
    std::string merged, error;
    mining::Settings checked;
    if (!mining::mergeSettingsJson(ctx_.settingsJson, patch, merged, error) || !mining::parseSettings(merged, checked, error)) {
        print("Error: " + error);
        return false;
    }
    if (!ctx_.store->writeAtomic(kSettingsPath, merged)) {
        print("Error: no se pudo escribir la configuración en la flash.");
        return false;
    }
    ctx_.settingsJson = merged;
    return true;
}

void Console::calibrate(const std::string& arguments) {
    if (!startsWith(arguments, "co ")) {
        print("Uso: calibrate co baseline|reference|estimate|clear");
        return;
    }
    std::string rest = trim(arguments.substr(3));
    if (rest == "clear") {
        if (save("{\"sensors\":{\"co\":{\"calibration\":null}}}")) {
            if (ctx_.co != nullptr) ctx_.co->setCalibration(std::nullopt);
            print("Calibración borrada: la manilla informa la tensión del sensor.");
        }
        return;
    }
    if (startsWith(rest, "baseline")) {
        int seconds = atoi(trim(rest.substr(8)).c_str());
        double volts;
        if (!measure(seconds > 0 ? seconds : 60, volts)) return;
        baselineVolts_ = volts;
        char buffer[160];
        snprintf(buffer, sizeof buffer, "Línea base: %.4f V. Expón el sensor al gas de referencia y ejecuta calibrate co reference <ppm>.",
                 volts);
        print(buffer);
        return;
    }
    if (startsWith(rest, "reference")) {
        std::string values = trim(rest.substr(9));
        char* end = nullptr;
        double ppm = strtod(values.c_str(), &end);
        int seconds = atoi(end);
        if (!(ppm > 0)) {
            print("Uso: calibrate co reference <ppm> [segundos]");
            return;
        }
        if (baselineVolts_ < 0) {
            print("Primero mide la línea base: calibrate co baseline");
            return;
        }
        double volts;
        if (!measure(seconds > 0 ? seconds : 60, volts)) return;
        mining::CoCalibration calibration;
        std::string error;
        if (!mining::computeCalibration(baselineVolts_, volts, ppm, calibration, error)) {
            print("Error: " + error);
            return;
        }
        saveCalibration(calibration);
        return;
    }
    if (startsWith(rest, "estimate")) {
        int seconds = atoi(trim(rest.substr(8)).c_str());
        double volts;
        if (!measure(seconds > 0 ? seconds : 120, volts)) return;
        mining::CoCalibration calibration;
        std::string error;
        if (!mining::estimateCalibration(volts, kSensorSupplyVolts, calibration, error)) {
            print("Error: " + error);
            return;
        }
        print("ESTIMACIÓN PROVISIONAL según la hoja de datos (Rs cae a 1/3 con 150 ppm), sin gas de referencia.");
        print("Sirve para demostraciones; no reemplaza una calibración con gas y no es apta para seguridad.");
        saveCalibration(calibration);
        return;
    }
    print("Uso: calibrate co baseline|reference|estimate|clear");
}

void Console::saveCalibration(const mining::CoCalibration& calibration) {
    char patch[160];
    snprintf(patch, sizeof patch, "{\"sensors\":{\"co\":{\"calibration\":{\"baseline_volts\":%.4f,\"ppm_per_volt\":%.2f}}}}",
             calibration.baselineVolts, calibration.ppmPerVolt);
    if (save(patch)) {
        if (ctx_.co != nullptr) ctx_.co->setCalibration(calibration);
        print(std::string("Calibración guardada y aplicada: ") + patch);
    }
}

bool Console::measure(int seconds, double& volts) {
    if (ctx_.hub == nullptr || ctx_.co == nullptr) {
        print("El sensor de CO está desactivado o los sensores son simulados.");
        return false;
    }
    print("Midiendo durante " + std::to_string(seconds) + " s...");
    double total = 0, lowest = 1e9, highest = -1e9;
    int count = 0;
    mining::Millis lastSample = -1;
    mining::Millis end = uptimeMs() + static_cast<mining::Millis>(seconds) * 1000;
    bool warned = false;
    while (uptimeMs() < end) {
        std::optional<mining::MonitorUpdate> update = ctx_.hub->latest();
        if (update && update->sampledAt != lastSample) {
            lastSample = update->sampledAt;
            if (update->snapshot.coVolts) {
                double value = *update->snapshot.coVolts;
                total += value;
                lowest = std::min(lowest, value);
                highest = std::max(highest, value);
                ++count;
            }
            if (update->snapshot.coState == mining::CoState::Warming && !warned) {
                warned = true;
                print("Aviso: el sensor aún se está precalentando; la medición puede no ser estable.");
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    if (count == 0) {
        print("Error: el sensor no entregó lecturas.");
        return false;
    }
    volts = total / count;
    double variation = volts > 0 ? (highest - lowest) / volts * 100.0 : 0.0;
    char buffer[160];
    snprintf(buffer, sizeof buffer, "Promedio %.4f V en %d muestras (mín. %.4f, máx. %.4f, variación %.1f %%).", volts, count, lowest,
             highest, variation);
    print(buffer);
    if (variation > kStableVariationPercent)
        print("Aviso: la lectura no es estable; deja el sensor precalentarse más y repite la medición.");
    return true;
}

}  // namespace device
