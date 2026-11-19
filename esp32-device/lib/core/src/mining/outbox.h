// Cola durable de tramas para la central (communication/outbox.py).
//
// Cada entrada es un archivo JSON con la trama que se enviará. Solo se borra al
// recibir el `ack` correspondiente; un reintento conserva el mismo
// identificador, por lo que la central no duplica registros. Un índice en
// memoria evita releer la flash para contar o buscar entradas.
#pragma once

#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "mining/file_store.h"
#include "mining/wallclock.h"

namespace mining {

constexpr size_t kMaxDetail = 120;

struct OutboxEntry {
    std::string id;
    std::string type;
    // Stored frame; may carry `_boot`/`_uptimeMs` instead of `sentAt`.
    std::string frame;
};

class Outbox {
public:
    using Random = std::function<uint32_t()>;

    Outbox(FileStore& store, std::string dir, Random random, std::string rejectedLog = "/rejected.log", size_t capacity = 256);

    // Reads the directory; corrupt entries are logged and removed.
    bool load(std::string& error);

    bool enqueueMessage(const std::string& code, const std::optional<std::string>& detail, const Stamp& stamp, std::string& id,
                        std::string& error);
    bool enqueueNoticeAck(int64_t noticeId, const std::string& stage, std::string& error);

    // Oldest entry; notice confirmations can go ahead while messages wait for an assignment.
    std::optional<OutboxEntry> first(bool skipMessages);
    void acknowledge(const std::string& id);
    // Entries the central rejected permanently: the reason is logged and the entry removed.
    void reject(const std::string& id, const std::string& reason);
    bool hasNoticeAck(int64_t noticeId, const std::string& stage);

    size_t pending();
    size_t pendingMessages();
    size_t capacity() const { return capacity_; }

private:
    struct Item {
        uint32_t seq;
        std::string id;
        std::string type;
        int64_t noticeId;
        std::string stage;
    };

    std::string pathOf(const Item& item) const;
    bool write(const std::string& type, const std::string& id, const std::string& content, int64_t noticeId,
               const std::string& stage, std::string& error);

    FileStore& store_;
    std::string dir_;
    Random random_;
    std::string rejectedLog_;
    size_t capacity_;
    std::mutex mutex_;
    std::vector<Item> items_;
    uint32_t nextSeq_ = 1;
};

// Replaces `_boot`/`_uptimeMs` with `sentAt` resolved by the clock. False when the
// time cannot be determined yet (the clock is not synchronized).
bool prepareFrame(const std::string& stored, const WallClock& clock, std::string& frame);

// "0000000042-<id>.<extension>": sequence and identifier, or false.
bool parseQueueName(const std::string& name, const std::string& extension, uint32_t& seq, std::string& id);
std::string queueName(uint32_t seq, const std::string& id, const std::string& extension);

}  // namespace mining
