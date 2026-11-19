#include "recorder.h"

#include <driver/i2s.h>
#include <unistd.h>

#include <cstdlib>

#include "hardware.h"
#include "mining/log.h"
#include "storage.h"

namespace device {

namespace {
constexpr i2s_port_t kPort = I2S_NUM_0;
// Frames read per call: 512 stereo frames of 32 bits.
constexpr size_t kChunkFrames = 512;
// Free space kept apart for the message queue and metadata.
constexpr size_t kReserveBytes = 64 * 1024;
}  // namespace

I2sRecorder::I2sRecorder(const mining::VoiceConfig& config, mining::WallClock& clock)
    : config_(config), clock_(clock), done_(xSemaphoreCreateBinary()) {
    input_ = static_cast<int32_t*>(malloc(kChunkFrames * 2 * sizeof(int32_t)));
    output_ = static_cast<int16_t*>(malloc(kChunkFrames * sizeof(int16_t)));
}

void I2sRecorder::cleanup() { unlink(fsPath(kPath).c_str()); }

double I2sRecorder::elapsedSeconds() const { return recording_ ? (uptimeMs() - started_) / 1000.0 : 0.0; }

std::string I2sRecorder::start() {
    if (recording_) return "Ya hay una grabación";
    if (input_ == nullptr || output_ == nullptr) return "Sin memoria";
    size_t needed = static_cast<size_t>(config_.maxSeconds) * config_.sampleRate * 2 + mining::kWavHeaderBytes + kReserveBytes;
    if (storageFreeBytes() < needed) return "Memoria llena";

    file_ = fopen(fsPath(kPath).c_str(), "w+b");
    if (file_ == nullptr) return "Error al guardar";
    uint8_t header[mining::kWavHeaderBytes];
    mining::writeWavHeader(header, static_cast<uint32_t>(config_.sampleRate), 0);
    fwrite(header, 1, sizeof header, file_);

    i2s_config_t i2s = {};
    i2s.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX);
    i2s.sample_rate = static_cast<uint32_t>(config_.sampleRate);
    i2s.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
    // Both slots are read; the configured one carries the INMP441 data (L/R pin).
    i2s.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
    i2s.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    i2s.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    i2s.dma_buf_count = 8;
    i2s.dma_buf_len = kChunkFrames;
    i2s.use_apll = false;
    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = config_.sck;
    pins.ws_io_num = config_.ws;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num = config_.sd;
    if (i2s_driver_install(kPort, &i2s, 0, nullptr) != ESP_OK) {
        fclose(file_);
        file_ = nullptr;
        cleanup();
        return "Micro no disponible";
    }
    if (i2s_set_pin(kPort, &pins) != ESP_OK) {
        i2s_driver_uninstall(kPort);
        fclose(file_);
        file_ = nullptr;
        cleanup();
        return "Micro no disponible";
    }

    converter_.reset();
    stop_ = false;
    writeError_ = false;
    frames_ = 0;
    peak_ = 0;
    started_ = uptimeMs();
    stamp_ = clock_.stamp();
    recording_ = true;
    xSemaphoreTake(done_, 0);
    if (xTaskCreatePinnedToCore(entry, "mining-recorder", 4096, this, 5, nullptr, 1) != pdPASS) {
        recording_ = false;
        i2s_driver_uninstall(kPort);
        fclose(file_);
        file_ = nullptr;
        cleanup();
        return "Sin memoria";
    }
    return "";
}

void I2sRecorder::entry(void* self) {
    static_cast<I2sRecorder*>(self)->run();
    vTaskDelete(nullptr);
}

void I2sRecorder::run() {
    const uint32_t maxFrames = static_cast<uint32_t>(config_.maxSeconds) * config_.sampleRate;
    // The INMP441 needs ~2^18 clock cycles to start: the first quarter second is dropped.
    uint32_t skip = static_cast<uint32_t>(config_.sampleRate / 4);
    const size_t slot = config_.rightSlot ? 1 : 0;
    while (!stop_) {
        size_t bytes = 0;
        if (i2s_read(kPort, input_, kChunkFrames * 2 * sizeof(int32_t), &bytes, pdMS_TO_TICKS(100)) != ESP_OK) continue;
        size_t frames = bytes / (2 * sizeof(int32_t)), count = 0;
        uint32_t written = frames_;
        for (size_t index = 0; index < frames; ++index) {
            int16_t sample = converter_.convert(input_[index * 2 + slot]);
            if (skip > 0) {
                --skip;
                continue;
            }
            if (written + count >= maxFrames) break;
            output_[count++] = sample;
            int magnitude = std::abs(static_cast<int>(sample));
            if (magnitude > peak_) peak_ = magnitude;
        }
        if (count == 0) continue;
        if (fwrite(output_, sizeof(int16_t), count, file_) != count) {
            writeError_ = true;
            break;
        }
        frames_ = written + static_cast<uint32_t>(count);
    }
    xSemaphoreGive(done_);
}

uint32_t I2sRecorder::halt() {
    stop_ = true;
    if (xSemaphoreTake(done_, pdMS_TO_TICKS(3000)) != pdTRUE) LOG_E("La tarea de grabación no terminó a tiempo");
    i2s_driver_uninstall(kPort);
    recording_ = false;
    return frames_;
}

mining::RecordingResult I2sRecorder::stop() {
    mining::RecordingResult result;
    if (!recording_) {
        result.error = "Sin grabación";
        return result;
    }
    uint32_t frames = halt();
    uint8_t header[mining::kWavHeaderBytes];
    mining::writeWavHeader(header, static_cast<uint32_t>(config_.sampleRate), frames * 2);
    bool ok = !writeError_ && fseek(file_, 0, SEEK_SET) == 0 && fwrite(header, 1, sizeof header, file_) == sizeof header;
    ok = fflush(file_) == 0 && ok;
    ok = fsync(fileno(file_)) == 0 && ok;
    ok = fclose(file_) == 0 && ok;
    file_ = nullptr;
    if (!ok) {
        cleanup();
        result.error = "Memoria llena";
        return result;
    }
    if (frames < mining::kMinRecordingSeconds * config_.sampleRate) {
        cleanup();
        result.error = "Grabación muy corta";
        return result;
    }
    result.ok = true;
    result.durationMs = static_cast<int>(static_cast<int64_t>(frames) * 1000 / config_.sampleRate);
    result.peak = peak_;
    result.stamp = stamp_;
    return result;
}

void I2sRecorder::cancel() {
    if (recording_) {
        halt();
        fclose(file_);
        file_ = nullptr;
    }
    cleanup();
}

void I2sRecorder::discard() { cleanup(); }

}  // namespace device
