#include "hardware.h"

#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_random.h>
#include <esp_timer.h>

#include <atomic>

#include "mining/log.h"

namespace device {

namespace {
SemaphoreHandle_t i2cMutex = nullptr;
constexpr mining::Millis kIoPeriodMs = 5;
// Presses per button (up, down, enter), read by the console test.
std::atomic<uint32_t> pressCounts[3];
}  // namespace

uint32_t buttonPresses(mining::Action action) { return pressCounts[static_cast<int>(action)].load(); }

mining::Millis uptimeMs() { return esp_timer_get_time() / 1000; }

uint32_t hardwareRandom() { return esp_random(); }

uint32_t nextBootId() {
    Preferences preferences;
    if (!preferences.begin("mining", false)) return hardwareRandom();
    uint32_t boot = preferences.getUInt("boot", 0) + 1;
    preferences.putUInt("boot", boot);
    preferences.end();
    return boot;
}

// --- I2C ----------------------------------------------------------------------

void beginI2c(const mining::I2cConfig& config) {
    if (i2cMutex == nullptr) i2cMutex = xSemaphoreCreateMutex();
    Wire.begin(config.sda, config.scl, config.frequency);
    // The MLX90614 can stretch the clock; keep a generous timeout.
    Wire.setTimeOut(50);
}

I2cLock::I2cLock() {
    if (i2cMutex != nullptr) xSemaphoreTake(i2cMutex, portMAX_DELAY);
}

I2cLock::~I2cLock() {
    if (i2cMutex != nullptr) xSemaphoreGive(i2cMutex);
}

std::vector<uint8_t> scanI2c() {
    std::vector<uint8_t> found;
    I2cLock lock;
    for (uint8_t address = 0x08; address <= 0x77; ++address) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) found.push_back(address);
    }
    return found;
}

bool WireSmBus::readBlock(uint8_t address, uint8_t command, uint8_t* data, size_t length, std::string& error) {
    I2cLock lock;
    Wire.beginTransmission(address);
    Wire.write(command);
    // Repeated start: the read follows the command without a stop condition.
    uint8_t status = Wire.endTransmission(false);
    if (status != 0) {
        error = "Error I2C " + std::to_string(status) + " en 0x" + String(address, HEX).c_str();
        return false;
    }
    size_t received = Wire.requestFrom(static_cast<uint16_t>(address), length, true);
    if (received != length) {
        error = "El dispositivo I2C 0x" + std::string(String(address, HEX).c_str()) + " no respondió";
        while (Wire.available()) Wire.read();
        return false;
    }
    for (size_t index = 0; index < length; ++index) data[index] = static_cast<uint8_t>(Wire.read());
    return true;
}

// --- ADC ----------------------------------------------------------------------

EspAnalog::EspAnalog(int pin) : pin_(pin) {
    analogReadResolution(12);
    analogSetPinAttenuation(pin_, ADC_11db);
}

bool EspAnalog::readMillivolts(int& millivolts) {
    millivolts = static_cast<int>(analogReadMilliVolts(pin_));
    return true;
}

// --- IoTask -------------------------------------------------------------------

IoTask::IoTask(const mining::Settings& settings, mining::PatternOutputs& outputs, mining::EventQueue& events)
    : settings_(settings),
      outputs_(outputs),
      events_(events),
      buttons_{{settings.buttons.up, mining::Action::Up, true, true, 0},
               {settings.buttons.down, mining::Action::Down, true, true, 0},
               {settings.buttons.enter, mining::Action::Enter, true, true, 0}},
      bounceMs_(static_cast<mining::Millis>(settings.buttons.bounceSeconds * 1000)) {}

void IoTask::begin() {
    if (settings_.alerts.enabled) {
        const mining::AlertsConfig& alerts = settings_.alerts;
        // Latch the inactive levels before enabling the drivers so the buzzer (active low) does not chirp.
        write(mining::OutputLevels{});
        for (int pin : {alerts.ledRed, alerts.ledGreen, alerts.ledBlue, alerts.buzzerPin, alerts.motorPin}) pinMode(pin, OUTPUT);
        write(mining::OutputLevels{});
    }
    for (Button& button : buttons_) {
        // Pull-up: pressed reads LOW.
        pinMode(button.pin, INPUT_PULLUP);
        button.raw = button.stable = digitalRead(button.pin) == HIGH;
    }
    xTaskCreatePinnedToCore(entry, "mining-io", 3072, this, 4, nullptr, 1);
}

void IoTask::entry(void* self) {
    auto* task = static_cast<IoTask*>(self);
    TickType_t wake = xTaskGetTickCount();
    for (;;) {
        task->step(uptimeMs());
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(kIoPeriodMs));
    }
}

void IoTask::step(mining::Millis now) {
    if (settings_.alerts.enabled) {
        mining::OutputLevels levels = outputs_.levels(now);
        if (firstWrite_ || levels != written_) write(levels);
    }
    for (Button& button : buttons_) {
        bool raw = digitalRead(button.pin) == HIGH;
        if (raw != button.raw) {
            button.raw = raw;
            button.changedAt = now;
        } else if (raw != button.stable && now - button.changedAt >= bounceMs_) {
            button.stable = raw;
            if (!raw) {
                events_.push(button.action);
                pressCounts[static_cast<int>(button.action)].fetch_add(1);
            }
        }
    }
}

void IoTask::write(const mining::OutputLevels& levels) {
    const mining::AlertsConfig& alerts = settings_.alerts;
    auto level = [](bool on, bool activeHigh) { return on == activeHigh ? HIGH : LOW; };
    digitalWrite(alerts.ledRed, level(levels.red, alerts.ledActiveHigh));
    digitalWrite(alerts.ledGreen, level(levels.green, alerts.ledActiveHigh));
    digitalWrite(alerts.ledBlue, level(levels.blue, alerts.ledActiveHigh));
    digitalWrite(alerts.buzzerPin, level(levels.buzzer, alerts.buzzerActiveHigh));
    // The NPN stage switches the motor on with a high level.
    digitalWrite(alerts.motorPin, levels.motor ? HIGH : LOW);
    written_ = levels;
    firstWrite_ = false;
}

}  // namespace device
