#include "mining/link_session.h"

#include <limits>

#include "mining/log.h"

namespace mining {

namespace {
const char kHeartbeat[] = "{\"type\":\"heartbeat\"}";

TransportEvent transport(TransportKind kind, const std::string& messageId = "", const std::string& detail = "") {
    TransportEvent event;
    event.kind = kind;
    event.messageId = messageId;
    event.detail = detail;
    return event;
}
}  // namespace

LinkSession::LinkSession(LinkTiming timing, Outbox& outbox, WallClock& clock, EventQueue& events, Telemetry telemetry)
    : timing_(timing), outbox_(outbox), clock_(clock), events_(events), telemetry_(std::move(telemetry)) {}

void LinkSession::opened(Millis now, Send send) {
    send_ = std::move(send);
    open_ = true;
    connected_ = false;
    failed_ = false;
    failure_.clear();
    pending_ = Pending::None;
    outboxRetryAt_ = 0;
    request(kHeartbeat, Pending::Heartbeat, now);
}

void LinkSession::closed(const std::string& detail) {
    open_ = false;
    connected_ = false;
    pending_ = Pending::None;
    send_ = nullptr;
    events_.push(transport(TransportKind::Disconnected, "", detail));
}

void LinkSession::fail(const std::string& reason) {
    if (failed_) return;
    failed_ = true;
    failure_ = reason;
    LOG_W("Enlace con la central interrumpido: %s", reason.c_str());
}

void LinkSession::request(const std::string& frame, Pending kind, Millis now) {
    if (!send_ || !send_(frame)) {
        fail("No se pudo enviar la trama");
        return;
    }
    pending_ = kind;
    pendingSince_ = now;
}

void LinkSession::poll(Millis now) {
    if (!open_ || failed_) return;
    if (pending_ != Pending::None) {
        if (now - pendingSince_ >= timing_.responseTimeoutMs) fail("La central no respondió a tiempo");
        return;
    }
    if (!connected_) return;
    // Live readings keep flowing even while a long offline queue is being drained.
    if (now >= nextTelemetry_) {
        nextTelemetry_ = now + timing_.telemetryMs;
        std::optional<TelemetryReading> reading = telemetry_ ? telemetry_() : std::nullopt;
        if (reading) {
            nextHeartbeat_ = now + timing_.heartbeatMs;
            request(telemetryFrame(*reading), Pending::Telemetry, now);
            return;
        }
    }
    if (now >= nextHeartbeat_) {
        nextHeartbeat_ = now + timing_.heartbeatMs;
        request(kHeartbeat, Pending::Heartbeat, now);
        return;
    }
    if (now < outboxRetryAt_) return;
    std::optional<OutboxEntry> entry = outbox_.first(now < blockedUntil_);
    if (!entry) return;
    std::string frame;
    if (!prepareFrame(entry->frame, clock_, frame)) {
        // Without the central's time the entry waits; avoid rereading the flash on every poll.
        outboxRetryAt_ = now + 1000;
        return;
    }
    pendingEntry_ = *entry;
    request(frame, Pending::Entry, now);
}

void LinkSession::received(const std::string& text, Millis now) {
    JsonDocument frame;
    if (deserializeJson(frame, text) || !frame.is<JsonObject>()) {
        LOG_W("Trama inválida de la central");
        return;
    }
    std::string type = frame["type"] | "";
    if (type == "notice") {
        notice(frame);
        return;
    }
    if (pending_ == Pending::None) {
        LOG_D("Respuesta sin solicitud en vuelo: %s", type.c_str());
        return;
    }
    Pending kind = pending_;
    pending_ = Pending::None;
    if (type == "error") {
        handleError(kind, frame["code"] | "unavailable", frame["message"] | "Error de la central", now);
    } else if (type == "ack") {
        handleAck(kind, frame, now);
    } else {
        fail("Respuesta inválida de la central");
    }
    if (!failed_) poll(now);
}

void LinkSession::handleAck(Pending kind, JsonDocument& frame, Millis now) {
    int64_t serverTime;
    if (frame["serverTime"].is<const char*>() && parseIso(frame["serverTime"].as<const char*>(), serverTime)) clock_.sync(serverTime);

    switch (kind) {
        case Pending::Heartbeat:
            if (!connected_) {
                connected_ = true;
                events_.push(transport(TransportKind::Connected));
                JsonVariantConst device = frame["device"];
                if (device.is<JsonObjectConst>()) {
                    TransportEvent identity = transport(TransportKind::Identity);
                    identity.identity.name = device["name"] | "";
                    if (device["minerName"].is<const char*>()) identity.identity.minerName = device["minerName"].as<const char*>();
                    identity.identity.zone = device["zone"] | "";
                    events_.push(identity);
                }
                nextTelemetry_ = telemetry_ ? now + timing_.telemetryMs : std::numeric_limits<Millis>::max();
                nextHeartbeat_ = now + timing_.heartbeatMs;
            }
            break;
        case Pending::Telemetry:
            break;
        case Pending::Entry: {
            bool message = pendingEntry_.type == "message";
            if (message && (std::string(frame["clientMessageId"] | "") != pendingEntry_.id || !(frame["messageId"] | 0LL))) {
                fail("La confirmación no corresponde al mensaje");
                return;
            }
            outbox_.acknowledge(pendingEntry_.id);
            blockedUntil_ = 0;
            if (message) events_.push(transport(TransportKind::Delivered, pendingEntry_.id));
            break;
        }
        case Pending::None:
            break;
    }
}

void LinkSession::handleError(Pending kind, const std::string& code, const std::string& message, Millis now) {
    switch (kind) {
        case Pending::Heartbeat:
            fail(message);
            break;
        case Pending::Telemetry:
            // A rejected reading is dropped; it must never block the link.
            LOG_W("La central rechazó una lectura: %s", message.c_str());
            break;
        case Pending::Entry:
            if (code == "invalid") {
                outbox_.reject(pendingEntry_.id, message);
                events_.push(transport(TransportKind::Rejected, pendingEntry_.id, message));
            } else {
                // Unassigned device or temporary failure: keep the entry and retry later.
                blockedUntil_ = now + timing_.blockedRetryMs;
                events_.push(transport(TransportKind::Blocked, pendingEntry_.id, message));
            }
            break;
        case Pending::None:
            break;
    }
}

void LinkSession::notice(JsonDocument& frame) {
    if (!frame["noticeId"].is<int64_t>() || frame["noticeId"].is<bool>()) return;
    int64_t noticeId = frame["noticeId"].as<int64_t>();
    // A notice the miner already confirmed offline is not shown again.
    if (outbox_.hasNoticeAck(noticeId, "read")) return;
    if (!outbox_.hasNoticeAck(noticeId, "delivered")) {
        std::string error;
        if (!outbox_.enqueueNoticeAck(noticeId, "delivered", error)) LOG_W("No se pudo guardar la entrega del aviso: %s", error.c_str());
    }
    NoticeReceived notice;
    notice.noticeId = noticeId;
    notice.code = frame["code"] | "";
    notice.text = frame["text"] | "";
    notice.severity = frame["severity"] | "info";
    events_.push(notice);
}

}  // namespace mining
