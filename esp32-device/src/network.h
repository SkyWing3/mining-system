// Wi-Fi, WebSocket con la central y subida HTTP de la voz.
#pragma once

#include <IPAddress.h>
#include <WebSocketsClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <atomic>
#include <mutex>
#include <string>

#include "mining/events.h"
#include "mining/link_session.h"
#include "mining/outbox.h"
#include "mining/settings.h"
#include "mining/url.h"
#include "mining/voice_queue.h"
#include "mining/wallclock.h"

namespace device {

void beginWifi(const mining::WifiConfig& config);
bool wifiConnected();
// IP literal, name.local by mDNS, or regular DNS.
bool resolveHost(const std::string& host, IPAddress& address);

// Tarea que mantiene el WebSocket y le entrega las tramas a LinkSession.
// Reintenta con espera creciente de 1 a 20 s, como el cliente en Python.
class LinkTask {
public:
    LinkTask(const mining::Settings& settings, mining::Outbox& outbox, mining::WallClock& clock, mining::EventQueue& events,
             mining::LinkSession::Telemetry telemetry);

    void begin();
    void wake();
    bool connected() const { return connected_; }
    std::string lastError() const;

private:
    enum class State { Idle, Connecting, Open };

    static void entry(void* self);
    void run();
    void attempt(mining::Millis now);
    void finish(const std::string& detail, mining::Millis now);
    void onEvent(WStype_t type, uint8_t* payload, size_t length);

    const mining::Settings& settings_;
    mining::CentralUrl url_;
    std::string headers_;
    WebSocketsClient socket_;
    mining::LinkSession session_;
    TaskHandle_t task_ = nullptr;
    State state_ = State::Idle;
    mining::Millis nextAttempt_ = 0;
    mining::Millis deadline_ = 0;
    mining::Millis retryMs_ = 1000;
    // begin() is only repeated when the central's address changes: the library
    // releases its TCP client on the next connection attempt, not in begin().
    bool begun_ = false;
    IPAddress address_;
    std::atomic<bool> connected_{false};
    mutable std::mutex errorMutex_;
    std::string lastError_;
};

// Subida idempotente de las grabaciones con reintentos (communication/uploader.py).
class Uploader {
public:
    Uploader(const mining::Settings& settings, mining::VoiceQueue& voices, mining::WallClock& clock, mining::EventQueue& events);

    void begin();
    void wake();

private:
    static void entry(void* self);
    void run();
    // Returns the HTTP status (0 when the central was not reached) and the reason.
    int post(const mining::QueuedVoice& voice, std::string& detail);

    const mining::Settings& settings_;
    mining::VoiceQueue& voices_;
    mining::WallClock& clock_;
    mining::EventQueue& events_;
    mining::CentralUrl url_;
    TaskHandle_t task_ = nullptr;
};

}  // namespace device
