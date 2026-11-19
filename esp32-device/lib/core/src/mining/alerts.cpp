#include "mining/alerts.h"

namespace mining {

namespace {
struct Timing {
    Millis on, off;
    int count;
};
constexpr Timing kDangerBuzz{400, 400, -1};
constexpr Timing kDangerVibration{1500, 3500, -1};
constexpr Timing kCautionBuzz{150, 0, 1};
constexpr Timing kNoticeVibration{250, 200, 2};
constexpr Timing kCriticalNoticeBuzz{200, 200, 3};
constexpr Timing kNoticeBuzz{100, 0, 1};
constexpr Timing kButtonVibration{60, 0, 1};
constexpr Millis kLedBlinkMs = 500;
}  // namespace

Rgb ledRgb(LedColor color) {
    switch (color) {
        case LedColor::Green: return {false, true, false};
        case LedColor::Yellow: return {true, true, false};
        case LedColor::Red: return {true, false, false};
        case LedColor::Blue: return {false, false, true};
        default: return {false, false, false};
    }
}

const char* ledColorName(LedColor color) {
    switch (color) {
        case LedColor::Green: return "verde";
        case LedColor::Yellow: return "amarillo";
        case LedColor::Red: return "rojo";
        case LedColor::Blue: return "azul";
        default: return "apagado";
    }
}

bool Pattern::active(Millis now) const {
    Millis period = onMs + offMs;
    Millis elapsed = now - started;
    if (elapsed < 0 || (count >= 0 && elapsed >= count * period)) return false;
    return period == 0 || elapsed % period < onMs;
}

// --- PatternOutputs ---------------------------------------------------

PatternOutputs::PatternOutputs(MonotonicClock clock) : clock_(std::move(clock)) {}

void PatternOutputs::setLed(LedColor color, bool blink) {
    std::lock_guard<std::mutex> lock(mutex_);
    led_ = color;
    blink_ = blink;
    blinkStarted_ = clock_();
}

void PatternOutputs::buzz(Millis onMs, Millis offMs, int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    buzzer_ = Pattern{onMs, offMs, count, clock_()};
}

void PatternOutputs::stopBuzzer() {
    std::lock_guard<std::mutex> lock(mutex_);
    buzzer_.reset();
}

void PatternOutputs::vibrate(Millis onMs, Millis offMs, int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    motor_ = Pattern{onMs, offMs, count, clock_()};
}

void PatternOutputs::stopMotor() {
    std::lock_guard<std::mutex> lock(mutex_);
    motor_.reset();
}

OutputLevels PatternOutputs::levels(Millis now) const {
    std::lock_guard<std::mutex> lock(mutex_);
    OutputLevels out;
    bool lit = led_ != LedColor::Off && (!blink_ || Pattern{kLedBlinkMs, kLedBlinkMs, -1, blinkStarted_}.active(now));
    if (lit) {
        Rgb rgb = ledRgb(led_);
        out.red = rgb.red;
        out.green = rgb.green;
        out.blue = rgb.blue;
    }
    out.buzzer = buzzer_ && buzzer_->active(now);
    out.motor = motor_ && motor_->active(now);
    return out;
}

LedColor PatternOutputs::ledColor() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return led_;
}

bool PatternOutputs::ledBlink() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return blink_;
}

// --- AlertController --------------------------------------------------

AlertController::AlertController(AlertOutputs& outputs, int silenceSeconds, bool buttonFeedback, bool monitorLink,
                                 MonotonicClock clock)
    : outputs_(outputs),
      silenceMs_(static_cast<Millis>(silenceSeconds) * 1000),
      buttonFeedback_(buttonFeedback),
      monitorLink_(monitorLink),
      clock_(std::move(clock)) {
    applyLed();
}

bool AlertController::silenced() const { return clock_() < silencedUntil_; }

void AlertController::onLevel(Level level) {
    if (level == level_) return;
    Level previous = level_;
    level_ = level;
    if (level == Level::Danger) {
        silencedUntil_ = 0;
        startAlarm();
    } else {
        stopAlarm();
        if (level == Level::Caution && previous == Level::Normal) outputs_.buzz(kCautionBuzz.on, kCautionBuzz.off, kCautionBuzz.count);
    }
    applyLed();
}

void AlertController::onConnection(bool connected) {
    connected_ = connected;
    applyLed();
}

void AlertController::onNotice(const std::string& severity) {
    notice_ = severity;
    if (!alarmRunning_) {
        outputs_.vibrate(kNoticeVibration.on, kNoticeVibration.off, kNoticeVibration.count);
        const Timing& buzz = severity == "critical" ? kCriticalNoticeBuzz : kNoticeBuzz;
        outputs_.buzz(buzz.on, buzz.off, buzz.count);
    }
    applyLed();
}

void AlertController::onNoticeCleared() {
    notice_.reset();
    applyLed();
}

void AlertController::silence() {
    if (level_ != Level::Danger) return;
    silencedUntil_ = clock_() + silenceMs_;
    stopAlarm();
}

void AlertController::onButton() {
    if (buttonFeedback_ && !alarmRunning_) outputs_.vibrate(kButtonVibration.on, kButtonVibration.off, kButtonVibration.count);
}

void AlertController::tick() {
    if (level_ == Level::Danger && !alarmRunning_ && !silenced()) startAlarm();
}

void AlertController::close() {
    stopAlarm();
    outputs_.setLed(LedColor::Off, false);
}

void AlertController::startAlarm() {
    outputs_.buzz(kDangerBuzz.on, kDangerBuzz.off, kDangerBuzz.count);
    outputs_.vibrate(kDangerVibration.on, kDangerVibration.off, kDangerVibration.count);
    alarmRunning_ = true;
}

void AlertController::stopAlarm() {
    if (!alarmRunning_) return;
    outputs_.stopBuzzer();
    outputs_.stopMotor();
    alarmRunning_ = false;
}

void AlertController::applyLed() {
    LedColor color;
    bool blink;
    if (level_ == Level::Danger) {
        color = LedColor::Red, blink = true;
    } else if (notice_) {
        color = LedColor::Blue, blink = true;
    } else if (level_ == Level::Caution) {
        color = LedColor::Yellow, blink = false;
    } else if (monitorLink_ && !connected_) {
        color = LedColor::Blue, blink = false;
    } else {
        color = LedColor::Green, blink = false;
    }
    // Re-sending the same blink pattern would restart it and make the LED flicker.
    if (hasLed_ && color == ledColor_ && blink == ledBlink_) return;
    hasLed_ = true;
    ledColor_ = color;
    ledBlink_ = blink;
    outputs_.setLed(color, blink);
}

}  // namespace mining
