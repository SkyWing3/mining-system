// Consola serie (115200 baudios): estado, configuración y calibración del CO.
//
// Reemplaza a la edición de settings.json por SSH y a tools/calibrate_co.py de
// la versión para Raspberry Pi. Escribe `help` para ver los comandos.
#pragma once

#include <string>

#include "mining/alerts.h"

#include "mining/file_store.h"
#include "mining/outbox.h"
#include "mining/sensors.h"
#include "mining/settings.h"
#include "mining/voice_queue.h"
#include "mining/wallclock.h"

namespace device {

class LinkTask;

constexpr const char* kSettingsPath = "/settings.json";

// Configuración guardada o, si no existe, la de fábrica.
std::string loadSettingsJson(mining::FileStore& store);

struct ConsoleContext {
    mining::FileStore* store = nullptr;
    std::string settingsJson;
    // Error of the stored configuration (safe mode), empty when it is valid.
    std::string configError;
    const mining::Settings* settings = nullptr;
    mining::SensorHub* hub = nullptr;
    mining::CoSensor* co = nullptr;
    mining::SimulatedSensors* simulated = nullptr;
    mining::Outbox* outbox = nullptr;
    mining::VoiceQueue* voices = nullptr;
    mining::WallClock* clock = nullptr;
    mining::PatternOutputs* outputs = nullptr;
    LinkTask* link = nullptr;
};

class Console {
public:
    explicit Console(ConsoleContext context) : ctx_(std::move(context)) {}
    void begin();

private:
    static void entry(void* self);
    void run();
    void execute(const std::string& line);
    void help();
    void status();
    void i2cScan();
    void testOutputs();
    void testButtons(int seconds);
    void configSet(const std::string& patch);
    // Merges, validates and stores the configuration.
    bool save(const std::string& patch);
    void calibrate(const std::string& arguments);
    bool measure(int seconds, double& volts);
    void saveCalibration(const mining::CoCalibration& calibration);

    ConsoleContext ctx_;
    double baselineVolts_ = -1;
};

}  // namespace device
