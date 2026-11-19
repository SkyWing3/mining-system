// Grabación del INMP441 por I2S directamente a un WAV en LittleFS.
#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <atomic>
#include <cstdio>

#include "mining/recorder.h"
#include "mining/settings.h"
#include "mining/wallclock.h"
#include "mining/wav.h"

namespace device {

class I2sRecorder : public mining::Recorder {
public:
    I2sRecorder(const mining::VoiceConfig& config, mining::WallClock& clock);

    // Removes a recording left by a reset in the middle of a recording.
    void cleanup();

    bool recording() const override { return recording_; }
    double elapsedSeconds() const override;
    std::string start() override;
    mining::RecordingResult stop() override;
    void cancel() override;
    void discard() override;
    std::string path() const override { return kPath; }

    static constexpr const char* kPath = "/rec.wav";

private:
    static void entry(void* self);
    void run();
    // Stops the I2S task and driver; returns the samples written.
    uint32_t halt();

    mining::VoiceConfig config_;
    mining::WallClock& clock_;
    mining::MicConverter converter_;
    SemaphoreHandle_t done_;
    FILE* file_ = nullptr;
    int32_t* input_ = nullptr;
    int16_t* output_ = nullptr;
    std::atomic<bool> stop_{false};
    std::atomic<bool> writeError_{false};
    std::atomic<uint32_t> frames_{0};
    int peak_ = 0;
    bool recording_ = false;
    mining::Millis started_ = 0;
    mining::Stamp stamp_;
};

}  // namespace device
