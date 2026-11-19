// Reglas de aviso de la manilla (alerts/controller.py y alerts/outputs.py).
//
// LED: verde normal, amarillo precaución, rojo peligro, azul aviso de la central
// o sin enlace. Motor: vibración larga en peligro, doble al recibir un aviso y
// corta al pulsar un botón. Buzzer: intermitente en peligro; Enter lo silencia
// durante `silence_seconds`.
#pragma once

#include <mutex>
#include <optional>
#include <string>

#include "mining/types.h"

namespace mining {

enum class LedColor : uint8_t { Off, Green, Yellow, Red, Blue };

struct Rgb {
    bool red, green, blue;
};
Rgb ledRgb(LedColor color);
const char* ledColorName(LedColor color);

// Patrón intermitente: `count` < 0 repite hasta detenerlo.
struct Pattern {
    Millis onMs = 0;
    Millis offMs = 0;
    int count = 1;
    Millis started = 0;

    // Whether the output is energized at `now`.
    bool active(Millis now) const;
};

class AlertOutputs {
public:
    virtual ~AlertOutputs() = default;
    virtual void setLed(LedColor color, bool blink) = 0;
    virtual void buzz(Millis onMs, Millis offMs, int count) = 0;
    virtual void stopBuzzer() = 0;
    virtual void vibrate(Millis onMs, Millis offMs, int count) = 0;
    virtual void stopMotor() = 0;
};

// Estado instantáneo de las salidas físicas.
struct OutputLevels {
    bool red = false, green = false, blue = false;
    bool buzzer = false;
    bool motor = false;

    bool operator==(const OutputLevels& other) const {
        return red == other.red && green == other.green && blue == other.blue && buzzer == other.buzzer && motor == other.motor;
    }
    bool operator!=(const OutputLevels& other) const { return !(*this == other); }
};

// Guarda los patrones pedidos; una tarea periódica consulta `levels(now)` y
// escribe los GPIO. Es seguro llamarla desde varias tareas.
class PatternOutputs : public AlertOutputs {
public:
    explicit PatternOutputs(MonotonicClock clock);

    void setLed(LedColor color, bool blink) override;
    void buzz(Millis onMs, Millis offMs, int count) override;
    void stopBuzzer() override;
    void vibrate(Millis onMs, Millis offMs, int count) override;
    void stopMotor() override;

    OutputLevels levels(Millis now) const;
    LedColor ledColor() const;
    bool ledBlink() const;

private:
    MonotonicClock clock_;
    mutable std::mutex mutex_;
    LedColor led_ = LedColor::Off;
    bool blink_ = false;
    Millis blinkStarted_ = 0;
    std::optional<Pattern> buzzer_;
    std::optional<Pattern> motor_;
};

class AlertController {
public:
    AlertController(AlertOutputs& outputs, int silenceSeconds, bool buttonFeedback, bool monitorLink, MonotonicClock clock);

    bool silenced() const;
    Level level() const { return level_; }

    void onLevel(Level level);
    void onConnection(bool connected);
    void onNotice(const std::string& severity);
    void onNoticeCleared();
    void silence();
    void onButton();
    // Resume the alarm when the silence period ends and the danger persists.
    void tick();
    void close();

private:
    void startAlarm();
    void stopAlarm();
    void applyLed();

    AlertOutputs& outputs_;
    Millis silenceMs_;
    bool buttonFeedback_;
    // Without a configured central there is no link to report as lost.
    bool monitorLink_;
    MonotonicClock clock_;
    Level level_ = Level::Normal;
    bool connected_ = false;
    std::optional<std::string> notice_;
    Millis silencedUntil_ = 0;
    bool alarmRunning_ = false;
    bool hasLed_ = false;
    LedColor ledColor_ = LedColor::Off;
    bool ledBlink_ = false;
};

}  // namespace mining
