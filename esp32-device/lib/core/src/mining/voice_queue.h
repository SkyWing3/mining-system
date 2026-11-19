// Cola durable de mensajes de voz (WAV + metadatos) pendientes de subir
// (communication/voice_queue.py). La grabación se escribe en un archivo
// temporal; al encolarla se renombra, así que no se copia el audio.
#pragma once

#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "mining/file_store.h"
#include "mining/wallclock.h"

namespace mining {

struct QueuedVoice {
    std::string id;
    std::string audioPath;
    std::string metaPath;
    Stamp stamp;
    int durationMs = 0;
    // Pico absoluto de las muestras: la ganancia se aplica al subir el audio.
    int peak = 0;
};

class VoiceQueue {
public:
    using Random = std::function<uint32_t()>;
    enum class Result { Ok, Full, Error };

    VoiceQueue(FileStore& store, std::string dir, int maxPending, Random random, std::string rejectedLog = "/rejected.log");

    bool load(std::string& error);
    Result enqueue(const std::string& recordingPath, int durationMs, int peak, const Stamp& stamp, std::string& id);
    std::optional<QueuedVoice> first();
    void remove(const QueuedVoice& voice);
    void reject(const QueuedVoice& voice, const std::string& reason);

    int pending();
    int maxPending() const { return maxPending_; }

private:
    struct Item {
        uint32_t seq;
        QueuedVoice voice;
    };

    void erase(const std::string& id);

    FileStore& store_;
    std::string dir_;
    int maxPending_;
    Random random_;
    std::string rejectedLog_;
    std::mutex mutex_;
    std::vector<Item> items_;
    uint32_t nextSeq_ = 1;
};

}  // namespace mining
