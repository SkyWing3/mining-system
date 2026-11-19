#include "mining/voice_queue.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <set>

#include "mining/outbox.h"
#include "mining/text.h"

namespace mining {

namespace {
constexpr size_t kRejectedLogBytes = 16 * 1024;
}

VoiceQueue::VoiceQueue(FileStore& store, std::string dir, int maxPending, Random random, std::string rejectedLog)
    : store_(store), dir_(std::move(dir)), maxPending_(maxPending), random_(std::move(random)), rejectedLog_(std::move(rejectedLog)) {}

bool VoiceQueue::load(std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    items_.clear();
    nextSeq_ = 1;
    if (!store_.makeDir(dir_)) {
        error = "No se pudo crear " + dir_;
        return false;
    }
    std::vector<std::string> names = store_.list(dir_);
    std::set<std::string> present(names.begin(), names.end());
    for (const std::string& name : names) {
        uint32_t seq;
        std::string id;
        std::string path = dir_ + "/" + name;
        if (parseQueueName(name, ".json", seq, id)) {
            nextSeq_ = std::max(nextSeq_, seq + 1);
            std::string audioName = queueName(seq, id, ".wav"), content;
            JsonDocument meta;
            if (!present.count(audioName) || !store_.read(path, content) || deserializeJson(meta, content) ||
                !meta["durationMs"].is<int>()) {
                store_.remove(path);
                continue;
            }
            QueuedVoice voice;
            voice.id = id;
            voice.audioPath = dir_ + "/" + audioName;
            voice.metaPath = path;
            voice.durationMs = meta["durationMs"].as<int>();
            voice.peak = meta["peak"] | 0;
            int64_t epoch;
            if (meta["recordedAt"].is<const char*>() && parseIso(meta["recordedAt"].as<const char*>(), epoch)) {
                voice.stamp = Stamp{epoch, 0, 0};
            } else {
                voice.stamp = Stamp{-1, meta["_boot"] | 0u, meta["_uptimeMs"] | static_cast<int64_t>(0)};
            }
            items_.push_back({seq, voice});
        } else if (parseQueueName(name, ".wav", seq, id)) {
            nextSeq_ = std::max(nextSeq_, seq + 1);
            // Audio without metadata: the enqueue was interrupted before completing.
            if (!present.count(queueName(seq, id, ".json"))) store_.remove(path);
        } else if (name.size() > 4 && name.compare(name.size() - 4, 4, ".tmp") == 0) {
            store_.remove(path);
        }
    }
    std::sort(items_.begin(), items_.end(), [](const Item& a, const Item& b) { return a.seq < b.seq; });
    return true;
}

VoiceQueue::Result VoiceQueue::enqueue(const std::string& recordingPath, int durationMs, int peak, const Stamp& stamp,
                                       std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (static_cast<int>(items_.size()) >= maxPending_) return Result::Full;
    QueuedVoice voice;
    voice.id = randomHexId(random_);
    voice.audioPath = dir_ + "/" + queueName(nextSeq_, voice.id, ".wav");
    voice.metaPath = dir_ + "/" + queueName(nextSeq_, voice.id, ".json");
    voice.stamp = stamp;
    voice.durationMs = durationMs;
    voice.peak = peak;

    JsonDocument meta;
    meta["voiceId"] = voice.id;
    meta["durationMs"] = durationMs;
    meta["peak"] = peak;
    if (stamp.absolute()) {
        meta["recordedAt"] = formatIso(stamp.epochMs);
    } else {
        meta["_boot"] = stamp.boot;
        meta["_uptimeMs"] = stamp.uptimeMs;
    }
    std::string content;
    serializeJson(meta, content);

    // The audio is moved first; the metadata file marks the entry as complete.
    if (!store_.rename(recordingPath, voice.audioPath)) return Result::Error;
    if (!store_.writeAtomic(voice.metaPath, content)) {
        store_.rename(voice.audioPath, recordingPath);
        return Result::Error;
    }
    items_.push_back({nextSeq_, voice});
    nextSeq_ += 1;
    id = voice.id;
    return Result::Ok;
}

std::optional<QueuedVoice> VoiceQueue::first() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (items_.empty()) return std::nullopt;
    return items_.front().voice;
}

void VoiceQueue::erase(const std::string& id) {
    items_.erase(std::remove_if(items_.begin(), items_.end(), [&](const Item& item) { return item.voice.id == id; }), items_.end());
}

void VoiceQueue::remove(const QueuedVoice& voice) {
    std::lock_guard<std::mutex> lock(mutex_);
    store_.remove(voice.metaPath);
    store_.remove(voice.audioPath);
    erase(voice.id);
}

void VoiceQueue::reject(const QueuedVoice& voice, const std::string& reason) {
    std::lock_guard<std::mutex> lock(mutex_);
    // Flash is limited: the audio is not kept, only the reason.
    store_.appendLine(rejectedLog_, "voz " + voice.id + ": " + reason, kRejectedLogBytes);
    store_.remove(voice.metaPath);
    store_.remove(voice.audioPath);
    erase(voice.id);
}

int VoiceQueue::pending() {
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<int>(items_.size());
}

}  // namespace mining
