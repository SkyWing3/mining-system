// Protocolo con la central sobre un WebSocket ya abierto (communication/client.py).
//
// Mantiene una sola solicitud en vuelo (telemetría, heartbeat o una entrada de
// la cola) y separa las respuestas `ack`/`error` de los avisos que la central
// envía por iniciativa propia. Las entradas de la cola solo se borran tras el
// `ack` que les corresponde. No depende del transporte: el firmware le entrega
// lo que llega por el socket y le da una función para enviar.
#pragma once

#include <ArduinoJson.h>

#include <functional>
#include <optional>
#include <string>

#include "mining/events.h"
#include "mining/outbox.h"
#include "mining/sensors.h"
#include "mining/wallclock.h"

namespace mining {

struct LinkTiming {
    Millis heartbeatMs = 20000;
    Millis telemetryMs = 2000;
    Millis responseTimeoutMs = 10000;
    // Messages waiting for an assignment (or a temporary server failure) are retried at this pace.
    Millis blockedRetryMs = 10000;
};

class LinkSession {
public:
    using Send = std::function<bool(const std::string&)>;
    using Telemetry = std::function<std::optional<TelemetryReading>()>;

    LinkSession(LinkTiming timing, Outbox& outbox, WallClock& clock, EventQueue& events, Telemetry telemetry);

    // The socket opened: the session starts with a heartbeat and waits for its ack.
    void opened(Millis now, Send send);
    void received(const std::string& text, Millis now);
    // Sends the next frame when nothing is in flight; detects response timeouts.
    void poll(Millis now);
    // The socket closed or could not be opened.
    void closed(const std::string& detail);

    bool open() const { return open_; }
    // True after the first ack of the session.
    bool connected() const { return connected_; }
    // The session must be dropped (timeout, invalid response...): the caller closes the socket.
    bool failed() const { return failed_; }
    const std::string& failure() const { return failure_; }

private:
    enum class Pending { None, Heartbeat, Telemetry, Entry };

    void request(const std::string& frame, Pending kind, Millis now);
    void handleAck(Pending kind, JsonDocument& frame, Millis now);
    void handleError(Pending kind, const std::string& code, const std::string& message, Millis now);
    void notice(JsonDocument& frame);
    void fail(const std::string& reason);

    LinkTiming timing_;
    Outbox& outbox_;
    WallClock& clock_;
    EventQueue& events_;
    Telemetry telemetry_;
    Send send_;
    bool open_ = false;
    bool connected_ = false;
    bool failed_ = false;
    std::string failure_;
    Pending pending_ = Pending::None;
    Millis pendingSince_ = 0;
    OutboxEntry pendingEntry_;
    Millis nextTelemetry_ = 0;
    Millis nextHeartbeat_ = 0;
    Millis blockedUntil_ = 0;
    Millis outboxRetryAt_ = 0;
};

}  // namespace mining
