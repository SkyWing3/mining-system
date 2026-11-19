// Acceso directo al ESP32-S3: reloj, bus I2C compartido, ADC y GPIO.
#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <string>
#include <vector>

#include "mining/alerts.h"
#include "mining/events.h"
#include "mining/sensors.h"
#include "mining/settings.h"

namespace device {

mining::Millis uptimeMs();
// Número de arranque guardado en NVS; distingue horas tomadas en arranques distintos.
uint32_t nextBootId();
uint32_t hardwareRandom();

// La OLED (tarea principal) y el MLX90614 (tarea de sensores) comparten el bus.
void beginI2c(const mining::I2cConfig& config);
class I2cLock {
public:
    I2cLock();
    ~I2cLock();
    I2cLock(const I2cLock&) = delete;
    I2cLock& operator=(const I2cLock&) = delete;
};

// Direcciones que responden en el bus (diagnóstico del montaje).
std::vector<uint8_t> scanI2c();

// Pulsaciones contadas desde el arranque (comando "test buttons").
uint32_t buttonPresses(mining::Action action);

class WireSmBus : public mining::SmBus {
public:
    bool readBlock(uint8_t address, uint8_t command, uint8_t* data, size_t length, std::string& error) override;
};

// SEN0564 en un GPIO con ADC1, atenuación de 11 dB (hasta ~3,1 V) y calibración de fábrica del ADC.
class EspAnalog : public mining::AnalogInput {
public:
    explicit EspAnalog(int pin);
    bool readMillivolts(int& millivolts) override;

private:
    int pin_;
};

// Tarea de 5 ms que escribe el LED RGB, el buzzer y el motor según los patrones
// pedidos y lee los tres pulsadores con antirrebote.
class IoTask {
public:
    IoTask(const mining::Settings& settings, mining::PatternOutputs& outputs, mining::EventQueue& events);
    // Configures the pins (outputs off) and starts the task.
    void begin();

private:
    struct Button {
        int pin;
        mining::Action action;
        bool stable;
        bool raw;
        mining::Millis changedAt;
    };

    static void entry(void* self);
    void step(mining::Millis now);
    void write(const mining::OutputLevels& levels);

    const mining::Settings& settings_;
    mining::PatternOutputs& outputs_;
    mining::EventQueue& events_;
    Button buttons_[3];
    mining::Millis bounceMs_;
    mining::OutputLevels written_;
    bool firstWrite_ = true;
};

}  // namespace device
