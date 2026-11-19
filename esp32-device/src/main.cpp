// Firmware de la manilla minera para ESP32-S3 (port de device/src/main.py y app.py).
//
// Tareas de FreeRTOS:
//   loop()               tarea principal: eventos, menú, alertas y OLED (núcleo 1)
//   mining-io            LED RGB, buzzer, motor y pulsadores cada 5 ms (núcleo 1)
//   mining-sensors       SEN0564 y MLX90614 cada sample_seconds (núcleo 1)
//   mining-recorder      INMP441 por I2S mientras se graba (núcleo 1)
//   mining-link          WebSocket con la central (núcleo 0, junto al Wi-Fi)
//   mining-voice-upload  subida HTTP de las grabaciones (núcleo 0)
//   mining-console       consola serie (núcleo 1)
#include <Arduino.h>

#include <algorithm>

#include "console.h"
#include "display.h"
#include "hardware.h"
#include "mining/app.h"
#include "mining/log.h"
#include "network.h"
#include "recorder.h"
#include "serial_io.h"
#include "storage.h"

namespace {

using mining::Millis;

device::LittleFsStore store;
mining::Settings settings;
mining::EventQueue* events = nullptr;
device::Display display;

mining::PatternOutputs* outputs = nullptr;
mining::WallClock* wallClock = nullptr;
mining::SensorHub* hub = nullptr;
mining::Application* app = nullptr;
device::LinkTask* linkTask = nullptr;
device::Uploader* uploaderTask = nullptr;
Millis nextTick = 0;

void serialLog(mining::LogLevel level, const char* message) {
    static const char* const names[] = {"D", "I", "W", "E"};
    device::serialPrintf("[%8lu] %s %s\r\n", static_cast<unsigned long>(millis()), names[static_cast<int>(level)], message);
}

void sensorTask(void*) {
    Millis next = device::uptimeMs();
    for (;;) {
        hub->sampleOnce();
        next += hub->intervalMs();
        Millis wait = next - device::uptimeMs();
        if (wait < 0) {
            // Fell behind (for example a long I2C timeout): resynchronize.
            next = device::uptimeMs();
            wait = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(wait));
    }
}

// Invalid configuration: show the error and keep only the console so it can be fixed.
void safeMode(device::ConsoleContext& console, const std::string& error) {
    LOG_E("Configuración inválida: %s", error.c_str());
    mining::Settings defaults;
    device::beginI2c(defaults.i2c);
    display.begin(defaults.display, defaults.i2c.frequency);
    display.message("CONFIG. INVALIDA", error + " Corrígela por la consola serie.");
    console.configError = error;
    (new device::Console(console))->begin();
}

}  // namespace

void setup() {
    device::beginSerial();
    mining::setLogSink(serialLog);
    LOG_I("Manilla minera ESP32-S3");

    events = new mining::EventQueue(48);
    device::mountStorage();
    device::ConsoleContext console;
    console.store = &store;
    console.settingsJson = device::loadSettingsJson(store);
    std::string error;
    if (!mining::parseSettings(console.settingsJson, settings, error)) {
        safeMode(console, error);
        return;
    }
    console.settings = &settings;

    // Outputs first: the buzzer and the motor must be off as soon as possible.
    outputs = new mining::PatternOutputs(device::uptimeMs);
    (new device::IoTask(settings, *outputs, *events))->begin();

    device::beginI2c(settings.i2c);
    display.begin(settings.display, settings.i2c.frequency);
    console.outputs = outputs;
    std::string found;
    for (uint8_t address : device::scanI2c()) {
        char hex[8];
        snprintf(hex, sizeof hex, " 0x%02X", address);
        found += hex;
    }
    LOG_I("Bus I2C (SDA %d, SCL %d):%s", settings.i2c.sda, settings.i2c.scl, found.empty() ? " sin dispositivos" : found.c_str());

    wallClock = new mining::WallClock(device::nextBootId(), device::uptimeMs);
    console.clock = wallClock;

    // --- sensors ---
    mining::SensorSource* source;
    if (settings.sensors.simulated) {
        auto* simulated = new mining::SimulatedSensors(device::uptimeMs, device::hardwareRandom());
        console.simulated = simulated;
        source = simulated;
    } else {
        mining::CoSensor* co = nullptr;
        mining::Mlx90614* thermometer = nullptr;
        if (settings.sensors.co.enabled) {
            co = new mining::CoSensor(*new device::EspAnalog(settings.sensors.co.pin), settings.sensors.co, device::uptimeMs);
            console.co = co;
        }
        if (settings.sensors.mlx90614.enabled) thermometer = new mining::Mlx90614(*new device::WireSmBus(), settings.sensors.mlx90614.address);
        source = new mining::HardwareSensors(co, thermometer);
    }
    hub = new mining::SensorHub(*source, settings.alerts, static_cast<Millis>(settings.sensors.sampleSeconds * 1000),
                                [](const mining::MonitorUpdate& update) { events->push(update); }, device::uptimeMs);
    console.hub = hub;

    // --- link with the central and queues ---
    mining::AppContext context;
    context.settings = &settings;
    context.outputs = outputs;
    context.clock = wallClock;
    context.monotonic = device::uptimeMs;
    if (settings.linkConfigured()) {
        auto* outbox = new mining::Outbox(store, "/out", device::hardwareRandom);
        if (!outbox->load(error)) LOG_E("Cola de mensajes: %s", error.c_str());
        device::beginWifi(settings.wifi);
        linkTask = new device::LinkTask(settings, *outbox, *wallClock, *events, [] { return hub->telemetry(); });
        context.outbox = outbox;
        context.wakeLink = [] { linkTask->wake(); };
        console.outbox = outbox;
        console.link = linkTask;
        if (settings.voice.enabled) {
            auto* voices = new mining::VoiceQueue(store, "/voice", settings.voice.maxPending, device::hardwareRandom);
            if (!voices->load(error)) LOG_E("Cola de voz: %s", error.c_str());
            uploaderTask = new device::Uploader(settings, *voices, *wallClock, *events);
            context.voices = voices;
            context.wakeUploader = [] { uploaderTask->wake(); };
            console.voices = voices;
        }
    } else {
        LOG_W("Sin credencial de la central: la manilla funciona sin enlace (config set para configurarla).");
    }
    if (settings.voice.enabled) {
        auto* recorder = new device::I2sRecorder(settings.voice, *wallClock);
        recorder->cleanup();
        context.recorder = recorder;
    }

    app = new mining::Application(context);

    // --- tasks ---
    xTaskCreatePinnedToCore(sensorTask, "mining-sensors", 4096, nullptr, 3, nullptr, 1);
    if (linkTask != nullptr) linkTask->begin();
    if (uploaderTask != nullptr) uploaderTask->begin();
    (new device::Console(console))->begin();
    nextTick = device::uptimeMs();
}

// Main loop: process events, tick once per second and redraw when the frame changes.
void loop() {
    if (app == nullptr) {
        delay(100);
        return;
    }
    Millis wait = std::max<Millis>(0, nextTick - device::uptimeMs());
    if (std::optional<mining::Event> event = events->pop(std::min<Millis>(wait, 1000))) app->process(*event);
    Millis now = device::uptimeMs();
    if (now >= nextTick) {
        app->tick();
        nextTick = std::max(nextTick + 1000, now);
    }
    display.show(*app);
}
