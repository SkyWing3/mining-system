// Eventos que llegan a la tarea principal desde botones, red, sensores y audio.
//
// Todos los cambios de estado ocurren en la tarea principal, que consume esta
// cola. Las demás tareas (sensores, WebSocket, subida de voz, botones) solo
// publican eventos.
#pragma once

#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <variant>

#include "mining/levels.h"
#include "mining/readings.h"
#include "mining/types.h"

namespace mining {

struct MonitorUpdate {
    SensorSnapshot snapshot;
    Assessment assessment;
    Millis sampledAt = 0;
};

// Identidad que la central devuelve en el primer ack.
struct Identity {
    std::string name;
    std::optional<std::string> minerName;
    std::string zone;
};

enum class TransportKind : uint8_t { Connected, Disconnected, Identity, Delivered, Rejected, Blocked };

struct TransportEvent {
    TransportKind kind;
    std::string messageId;
    std::string detail;
    Identity identity;
};

struct NoticeReceived {
    int64_t noticeId = 0;
    std::string code;
    std::string text;
    std::string severity = "info";
};

struct VoiceEvent {
    bool uploaded = false;
    std::string voiceId;
    std::string detail;
};

using Event = std::variant<Action, MonitorUpdate, TransportEvent, NoticeReceived, VoiceEvent>;

// Cola acotada entre tareas. Si se llena (la tarea principal está bloqueada)
// descarta el evento más antiguo: las lecturas siguientes lo reemplazan.
class EventQueue {
public:
    explicit EventQueue(size_t capacity = 48) : capacity_(capacity) {}

    void push(Event event) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (events_.size() >= capacity_) events_.pop_front();
            events_.push_back(std::move(event));
        }
        ready_.notify_one();
    }

    std::optional<Event> pop(Millis timeoutMs) {
        std::unique_lock<std::mutex> lock(mutex_);
        if (events_.empty() && timeoutMs > 0) {
            ready_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { return !events_.empty(); });
        }
        if (events_.empty()) return std::nullopt;
        Event event = std::move(events_.front());
        events_.pop_front();
        return event;
    }

    size_t size() {
        std::lock_guard<std::mutex> lock(mutex_);
        return events_.size();
    }

private:
    size_t capacity_;
    std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<Event> events_;
};

}  // namespace mining
