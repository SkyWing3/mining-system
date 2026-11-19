// Dobles de prueba compartidos por las pruebas nativas (pio test -e native).
#pragma once

#include <string>
#include <vector>

#include "mining/alerts.h"
#include "mining/canvas.h"
#include "mining/recorder.h"
#include "mining/sensors.h"
#include "mining/text.h"

struct FakeClock {
    mining::Millis now = 0;
    mining::MonotonicClock fn() {
        return [this] { return now; };
    }
};

// Deterministic "random" source for identifiers.
struct Counter {
    uint32_t value = 0;
    std::function<uint32_t()> fn() {
        return [this] { return ++value; };
    }
};

class RecordingOutputs : public mining::AlertOutputs {
public:
    struct Call {
        std::string kind;
        mining::LedColor color = mining::LedColor::Off;
        bool blink = false;
        mining::Millis on = 0, off = 0;
        int count = 0;
    };
    std::vector<Call> history;

    void setLed(mining::LedColor color, bool blink) override { history.push_back({"led", color, blink}); }
    void buzz(mining::Millis on, mining::Millis off, int count) override { history.push_back({"buzz", {}, false, on, off, count}); }
    void stopBuzzer() override { history.push_back({"buzz-stop"}); }
    void vibrate(mining::Millis on, mining::Millis off, int count) override { history.push_back({"vibrate", {}, false, on, off, count}); }
    void stopMotor() override { history.push_back({"vibrate-stop"}); }

    const Call* last(const std::string& kind) const {
        for (auto it = history.rbegin(); it != history.rend(); ++it) {
            if (it->kind == kind) return &*it;
        }
        return nullptr;
    }
    size_t count(const std::string& kind) const {
        size_t total = 0;
        for (const auto& call : history) total += call.kind == kind;
        return total;
    }
};

// Records every drawing operation as text so frames can be compared.
class FakeCanvas : public mining::Canvas {
public:
    std::vector<std::string> ops;
    mining::Font font = mining::Font::Small;

    void clear() override { ops.clear(); }
    void setFont(mining::Font value) override { font = value; }
    int textWidth(const std::string& utf8) override {
        return static_cast<int>(mining::utf8Length(utf8)) * (font == mining::Font::Large ? 7 : 5);
    }
    void text(int x, int y, const std::string& utf8, bool on) override {
        ops.push_back("text " + std::to_string(x) + "," + std::to_string(y) + (on ? " " : " inv ") + utf8);
    }
    void box(int x0, int y0, int x1, int y1, bool on) override { shape("box", x0, y0, x1, y1, on); }
    void frame(int x0, int y0, int x1, int y1, bool on) override { shape("frame", x0, y0, x1, y1, on); }
    void roundedFrame(int x0, int y0, int x1, int y1, int, bool on) override { shape("rframe", x0, y0, x1, y1, on); }
    void line(int x0, int y0, int x1, int y1, bool on) override { shape("line", x0, y0, x1, y1, on); }
    void ellipse(int x0, int y0, int x1, int y1, bool filled, bool on) override {
        shape(filled ? "disc" : "ellipse", x0, y0, x1, y1, on);
    }

    bool hasText(const std::string& needle) const {
        for (const auto& op : ops) {
            if (op.compare(0, 5, "text ") == 0 && op.find(needle) != std::string::npos) return true;
        }
        return false;
    }

private:
    void shape(const char* kind, int x0, int y0, int x1, int y1, bool on) {
        ops.push_back(std::string(kind) + " " + std::to_string(x0) + "," + std::to_string(y0) + "," + std::to_string(x1) + "," +
                      std::to_string(y1) + (on ? "" : " off"));
    }
};

class FakeRecorder : public mining::Recorder {
public:
    explicit FakeRecorder(mining::MonotonicClock clock) : clock_(std::move(clock)) {}

    std::string startError;
    std::string stopError;
    int peak = 1000;
    bool discarded = false;
    bool cancelled = false;

    bool recording() const override { return recording_; }
    double elapsedSeconds() const override { return recording_ ? (clock_() - started_) / 1000.0 : 0.0; }
    std::string start() override {
        if (!startError.empty()) return startError;
        recording_ = true;
        started_ = clock_();
        discarded = false;
        return "";
    }
    mining::RecordingResult stop() override {
        mining::RecordingResult result;
        double seconds = elapsedSeconds();
        recording_ = false;
        if (!stopError.empty()) {
            result.error = stopError;
            return result;
        }
        result.ok = true;
        result.durationMs = static_cast<int>(seconds * 1000);
        result.peak = peak;
        result.stamp = mining::Stamp{1700000000000, 1, started_};
        return result;
    }
    void cancel() override {
        recording_ = false;
        cancelled = true;
    }
    void discard() override { discarded = true; }
    std::string path() const override { return "/rec.wav"; }

private:
    mining::MonotonicClock clock_;
    bool recording_ = false;
    mining::Millis started_ = 0;
};

class FakeAnalog : public mining::AnalogInput {
public:
    int millivolts = 120;
    bool fail = false;
    bool readMillivolts(int& value) override {
        if (fail) return false;
        value = millivolts;
        return true;
    }
};

// MLX90614 over SMBus with the datasheet frame layout (LSB, MSB, PEC).
class FakeBus : public mining::SmBus {
public:
    uint16_t ambientRaw = 0x3AD2;  // 28.01 °C
    uint16_t objectRaw = 0x3B00;
    bool fail = false;
    bool corruptPec = false;

    bool readBlock(uint8_t address, uint8_t command, uint8_t* data, size_t length, std::string& error) override {
        if (fail) {
            error = "NACK";
            return false;
        }
        uint16_t raw = command == 0x06 ? ambientRaw : objectRaw;
        data[0] = static_cast<uint8_t>(raw & 0xFF);
        data[1] = static_cast<uint8_t>(raw >> 8);
        const uint8_t frame[] = {static_cast<uint8_t>(address << 1), command, static_cast<uint8_t>((address << 1) | 1), data[0], data[1]};
        data[2] = static_cast<uint8_t>(mining::smbusPec(frame, sizeof frame) ^ (corruptPec ? 0xFF : 0));
        (void)length;
        return true;
    }
};

inline uint16_t rawFromCelsius(double celsius) { return static_cast<uint16_t>((celsius + 273.15) / 0.02 + 0.5); }
