#include "mining/outbox.h"

#include <ArduinoJson.h>

#include <algorithm>
#include <cstdio>

#include "mining/catalog.h"
#include "mining/log.h"
#include "mining/text.h"

namespace mining {

namespace {
constexpr size_t kRejectedLogBytes = 16 * 1024;
}

bool parseQueueName(const std::string& name, const std::string& extension, uint32_t& seq, std::string& id) {
    if (name.size() != 10 + 1 + 32 + extension.size() || name[10] != '-' ||
        name.compare(name.size() - extension.size(), extension.size(), extension) != 0)
        return false;
    uint64_t value = 0;
    for (size_t i = 0; i < 10; ++i) {
        if (name[i] < '0' || name[i] > '9') return false;
        value = value * 10 + static_cast<uint64_t>(name[i] - '0');
    }
    std::string candidate = name.substr(11, 32);
    if (value > UINT32_MAX || !isHexId(candidate)) return false;
    seq = static_cast<uint32_t>(value);
    id = candidate;
    return true;
}

std::string queueName(uint32_t seq, const std::string& id, const std::string& extension) {
    char prefix[12];
    snprintf(prefix, sizeof prefix, "%010lu-", static_cast<unsigned long>(seq));
    return prefix + id + extension;
}

bool prepareFrame(const std::string& stored, const WallClock& clock, std::string& frame) {
    JsonDocument document;
    if (deserializeJson(document, stored) || !document.is<JsonObject>()) return false;
    if (document["_boot"].is<uint32_t>()) {
        Stamp stamp{-1, document["_boot"].as<uint32_t>(), document["_uptimeMs"].as<int64_t>()};
        std::optional<int64_t> epoch = clock.resolve(stamp);
        if (!epoch) {
            // Queued during an earlier boot that never synchronized: the real time is unknown.
            epoch = clock.now();
            if (!epoch) return false;
            LOG_W("Mensaje de un arranque sin hora; se fecha al enviarlo");
        }
        document.remove("_boot");
        document.remove("_uptimeMs");
        document["sentAt"] = formatIso(*epoch);
    }
    frame.clear();
    serializeJson(document, frame);
    return true;
}

Outbox::Outbox(FileStore& store, std::string dir, Random random, std::string rejectedLog, size_t capacity)
    : store_(store), dir_(std::move(dir)), random_(std::move(random)), rejectedLog_(std::move(rejectedLog)), capacity_(capacity) {}

std::string Outbox::pathOf(const Item& item) const { return dir_ + "/" + queueName(item.seq, item.id, ".json"); }

bool Outbox::load(std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    items_.clear();
    nextSeq_ = 1;
    if (!store_.makeDir(dir_)) {
        error = "No se pudo crear " + dir_;
        return false;
    }
    for (const std::string& name : store_.list(dir_)) {
        uint32_t seq;
        std::string id, content;
        if (!parseQueueName(name, ".json", seq, id)) {
            // Leftover temporary files from an interrupted write.
            if (name.size() > 4 && name.compare(name.size() - 4, 4, ".tmp") == 0) store_.remove(dir_ + "/" + name);
            continue;
        }
        nextSeq_ = std::max(nextSeq_, seq + 1);
        std::string path = dir_ + "/" + name;
        JsonDocument document;
        if (!store_.read(path, content) || deserializeJson(document, content) || !document.is<JsonObject>() ||
            !document["type"].is<const char*>()) {
            store_.appendLine(rejectedLog_, "outbox " + id + ": entrada ilegible", kRejectedLogBytes);
            store_.remove(path);
            continue;
        }
        Item item{seq, id, document["type"].as<const char*>(), document["noticeId"] | static_cast<int64_t>(0),
                  document["stage"] | ""};
        items_.push_back(item);
    }
    std::sort(items_.begin(), items_.end(), [](const Item& a, const Item& b) { return a.seq < b.seq; });
    return true;
}

bool Outbox::write(const std::string& type, const std::string& id, const std::string& content, int64_t noticeId,
                   const std::string& stage, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (items_.size() >= capacity_) {
        error = "Cola llena";
        return false;
    }
    Item item{nextSeq_, id, type, noticeId, stage};
    if (!store_.writeAtomic(pathOf(item), content)) {
        error = "Error al guardar";
        return false;
    }
    nextSeq_ += 1;
    items_.push_back(item);
    return true;
}

bool Outbox::enqueueMessage(const std::string& code, const std::optional<std::string>& detail, const Stamp& stamp,
                            std::string& id, std::string& error) {
    if (!isMessageCode(code)) {
        error = "Mensaje fuera del catálogo";
        return false;
    }
    if (detail && (!isAutomaticMessage(code) || detail->empty() || utf8Length(*detail) > kMaxDetail)) {
        error = "Detalle inválido";
        return false;
    }
    std::string messageId = randomHexId(random_);
    JsonDocument frame;
    frame["type"] = "message";
    frame["clientMessageId"] = messageId;
    frame["code"] = code;
    if (stamp.absolute()) {
        frame["sentAt"] = formatIso(stamp.epochMs);
    } else {
        frame["_boot"] = stamp.boot;
        frame["_uptimeMs"] = stamp.uptimeMs;
    }
    if (detail) frame["detail"] = *detail;
    std::string content;
    serializeJson(frame, content);
    if (!write("message", messageId, content, 0, "", error)) return false;
    id = messageId;
    return true;
}

bool Outbox::enqueueNoticeAck(int64_t noticeId, const std::string& stage, std::string& error) {
    if (stage != "delivered" && stage != "read") {
        error = "Confirmación de aviso inválida";
        return false;
    }
    JsonDocument frame;
    frame["type"] = "notice-ack";
    frame["noticeId"] = noticeId;
    frame["stage"] = stage;
    std::string content;
    serializeJson(frame, content);
    return write("notice-ack", randomHexId(random_), content, noticeId, stage, error);
}

std::optional<OutboxEntry> Outbox::first(bool skipMessages) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const Item& item : items_) {
        if (skipMessages && item.type == "message") continue;
        OutboxEntry entry{item.id, item.type, ""};
        if (store_.read(pathOf(item), entry.frame)) return entry;
        LOG_W("Entrada de la cola sin archivo: %s", item.id.c_str());
    }
    return std::nullopt;
}

void Outbox::acknowledge(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto found = std::find_if(items_.begin(), items_.end(), [&](const Item& item) { return item.id == id; });
    if (found == items_.end()) return;
    store_.remove(pathOf(*found));
    items_.erase(found);
}

void Outbox::reject(const std::string& id, const std::string& reason) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto found = std::find_if(items_.begin(), items_.end(), [&](const Item& item) { return item.id == id; });
    if (found == items_.end()) return;
    std::string content;
    store_.read(pathOf(*found), content);
    store_.appendLine(rejectedLog_, "outbox " + id + ": " + reason + " " + content, kRejectedLogBytes);
    store_.remove(pathOf(*found));
    items_.erase(found);
}

bool Outbox::hasNoticeAck(int64_t noticeId, const std::string& stage) {
    std::lock_guard<std::mutex> lock(mutex_);
    return std::any_of(items_.begin(), items_.end(), [&](const Item& item) {
        return item.type == "notice-ack" && item.noticeId == noticeId && item.stage == stage;
    });
}

size_t Outbox::pending() {
    std::lock_guard<std::mutex> lock(mutex_);
    return items_.size();
}

size_t Outbox::pendingMessages() {
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<size_t>(std::count_if(items_.begin(), items_.end(), [](const Item& item) { return item.type == "message"; }));
}

}  // namespace mining
