// Grabación de voz. El firmware la implementa con el INMP441 por I2S y escribe
// el WAV directamente en la flash; las pruebas usan un doble.
#pragma once

#include <string>

#include "mining/wallclock.h"

namespace mining {

constexpr double kMinRecordingSeconds = 0.5;

struct RecordingResult {
    bool ok = false;
    int durationMs = 0;
    int peak = 0;
    Stamp stamp;
    std::string error;
};

class Recorder {
public:
    virtual ~Recorder() = default;
    virtual bool recording() const = 0;
    virtual double elapsedSeconds() const = 0;
    // Empty on success, otherwise the reason to show on the OLED.
    virtual std::string start() = 0;
    virtual RecordingResult stop() = 0;
    // Stops a running recording and deletes it.
    virtual void cancel() = 0;
    // Deletes the finished recording that was not queued.
    virtual void discard() = 0;
    // File holding the finished recording until it is queued.
    virtual std::string path() const = 0;
};

}  // namespace mining
