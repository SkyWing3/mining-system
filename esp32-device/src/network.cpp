#include "network.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFi.h>

#include <algorithm>
#include <cstdio>
#include <mutex>

#include "hardware.h"
#include "mining/log.h"
#include "mining/wav.h"
#include "storage.h"

namespace device {

namespace {

constexpr mining::Millis kMaxRetryMs = 20000;
constexpr mining::Millis kConnectTimeoutMs = 12000;
constexpr mining::Millis kUploadMaxBackoffMs = 60000;
constexpr mining::Millis kUploadIdleMs = 30000;
// Responses that can never succeed: the recording is discarded.
constexpr int kPermanentFailures[] = {400, 413, 415};

std::mutex mdnsMutex;
bool mdnsStarted = false;

std::string hostname() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char name[24];
    snprintf(name, sizeof name, "manilla-%02x%02x%02x", mac[3], mac[4], mac[5]);
    return name;
}

bool endsWith(const std::string& value, const std::string& suffix) {
    return value.size() > suffix.size() && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// Streams a queued WAV applying the normalization gain to the samples, so the
// file in flash is never rewritten.
class GainWavStream : public Stream {
public:
    GainWavStream(FILE* file, size_t size, double gain) : file_(file), size_(size), gain_(gain) {}

    int available() override { return static_cast<int>(size_ - consumed_); }
    int read() override {
        uint8_t byte;
        return readBytes(reinterpret_cast<char*>(&byte), 1) == 1 ? byte : -1;
    }
    int peek() override {
        if (position_ == filled_ && !refill()) return -1;
        return buffer_[position_];
    }
    size_t readBytes(char* out, size_t length) override {
        size_t copied = 0;
        while (copied < length) {
            if (position_ == filled_ && !refill()) break;
            size_t chunk = std::min(length - copied, filled_ - position_);
            memcpy(out + copied, buffer_ + position_, chunk);
            position_ += chunk;
            copied += chunk;
        }
        consumed_ += copied;
        return copied;
    }
    size_t write(uint8_t) override { return 0; }
    void flush() override {}

private:
    bool refill() {
        size_t offset = offset_;
        size_t count = fread(buffer_, 1, sizeof buffer_, file_);
        if (count == 0) return false;
        offset_ += count;
        position_ = 0;
        filled_ = count;
        if (gain_ > 1.0) {
            // Chunks start at even offsets and the header is 44 bytes, so samples stay aligned.
            for (size_t index = 0; index + 1 < count; index += 2) {
                if (offset + index < mining::kWavHeaderBytes) continue;
                int16_t sample = static_cast<int16_t>(buffer_[index] | (buffer_[index + 1] << 8));
                sample = mining::scaleSample(sample, gain_);
                buffer_[index] = static_cast<uint8_t>(sample & 0xFF);
                buffer_[index + 1] = static_cast<uint8_t>((sample >> 8) & 0xFF);
            }
        }
        return true;
    }

    FILE* file_;
    size_t size_;
    double gain_;
    uint8_t buffer_[512];
    size_t offset_ = 0;
    size_t position_ = 0;
    size_t filled_ = 0;
    size_t consumed_ = 0;
};

}  // namespace

void beginWifi(const mining::WifiConfig& config) {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(hostname().c_str());
    WiFi.setAutoReconnect(true);
    // Modem sleep between DTIM beacons: lower consumption, a few ms more latency.
    WiFi.setSleep(true);
    WiFi.begin(config.ssid.c_str(), config.password.empty() ? nullptr : config.password.c_str());
    LOG_I("Conectando a la red Wi-Fi %s", config.ssid.c_str());
}

bool wifiConnected() { return WiFi.status() == WL_CONNECTED; }

bool resolveHost(const std::string& host, IPAddress& address) {
    if (address.fromString(host.c_str())) return true;
    if (endsWith(host, ".local")) {
        {
            std::lock_guard<std::mutex> lock(mdnsMutex);
            if (!mdnsStarted) mdnsStarted = MDNS.begin(hostname().c_str());
        }
        IPAddress found = MDNS.queryHost(host.substr(0, host.size() - 6).c_str(), 2000);
        if (found != IPAddress(0, 0, 0, 0)) {
            address = found;
            return true;
        }
    }
    return WiFi.hostByName(host.c_str(), address) == 1;
}

// --- LinkTask -----------------------------------------------------------------

LinkTask::LinkTask(const mining::Settings& settings, mining::Outbox& outbox, mining::WallClock& clock, mining::EventQueue& events,
                   mining::LinkSession::Telemetry telemetry)
    : settings_(settings),
      session_(mining::LinkTiming{static_cast<mining::Millis>(settings.connection->heartbeatSeconds * 1000),
                                  static_cast<mining::Millis>(settings.connection->telemetrySeconds * 1000)},
               outbox, clock, events, std::move(telemetry)) {
    std::string error;
    mining::parseCentralUrl(settings.connection->url, url_, error);
    headers_ = "X-Device-Key: " + settings.connection->apiKey;
}

void LinkTask::begin() {
    socket_.onEvent([this](WStype_t type, uint8_t* payload, size_t length) { onEvent(type, payload, length); });
    xTaskCreatePinnedToCore(entry, "mining-link", 8192, this, 3, &task_, 0);
}

void LinkTask::wake() {
    if (task_ != nullptr) xTaskNotifyGive(task_);
}

std::string LinkTask::lastError() const {
    std::lock_guard<std::mutex> lock(errorMutex_);
    return lastError_;
}

void LinkTask::entry(void* self) { static_cast<LinkTask*>(self)->run(); }

void LinkTask::run() {
    for (;;) {
        mining::Millis now = uptimeMs();
        switch (state_) {
            case State::Idle:
                if (now >= nextAttempt_) attempt(now);
                break;
            case State::Connecting:
                socket_.loop();
                if (state_ == State::Connecting && uptimeMs() >= deadline_) {
                    socket_.disconnect();
                    if (state_ != State::Idle) finish("Tiempo de conexión agotado", uptimeMs());
                }
                break;
            case State::Open:
                socket_.loop();
                if (state_ == State::Open) session_.poll(uptimeMs());
                connected_ = session_.connected();
                if (state_ == State::Open && session_.failed()) {
                    std::string reason = session_.failure();
                    socket_.disconnect();
                    if (state_ != State::Idle) finish(reason, uptimeMs());
                }
                break;
        }
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(state_ == State::Idle ? 100 : 5));
    }
}

void LinkTask::attempt(mining::Millis now) {
    if (!wifiConnected()) {
        // Wi-Fi reconnects on its own; check again shortly.
        nextAttempt_ = now + 1000;
        return;
    }
    IPAddress address;
    if (!resolveHost(url_.host, address)) {
        finish("No se encontró " + url_.host, now);
        return;
    }
    // The connection uses the IP: the central does not route by host name.
    if (!begun_ || address != address_) {
        socket_.begin(address, url_.port, url_.path.c_str(), "");
        socket_.setExtraHeaders(headers_.c_str());
        socket_.setReconnectInterval(2000);
        begun_ = true;
        address_ = address;
    }
    state_ = State::Connecting;
    deadline_ = now + kConnectTimeoutMs;
}

void LinkTask::finish(const std::string& detail, mining::Millis now) {
    bool wasConnected = session_.connected();
    state_ = State::Idle;
    connected_ = false;
    {
        std::lock_guard<std::mutex> lock(errorMutex_);
        lastError_ = detail;
    }
    session_.closed(detail);
    if (wasConnected) retryMs_ = 1000;
    nextAttempt_ = now + retryMs_;
    retryMs_ = std::min(retryMs_ * 2, kMaxRetryMs);
}

void LinkTask::onEvent(WStype_t type, uint8_t* payload, size_t length) {
    mining::Millis now = uptimeMs();
    switch (type) {
        case WStype_CONNECTED:
            state_ = State::Open;
            LOG_I("WebSocket abierto con la central");
            session_.opened(now, [this](const std::string& frame) { return socket_.sendTXT(frame.c_str(), frame.size()); });
            break;
        case WStype_TEXT:
            if (state_ == State::Open) session_.received(std::string(reinterpret_cast<char*>(payload), length), now);
            break;
        case WStype_DISCONNECTED:
            if (state_ != State::Idle) finish(session_.failed() ? session_.failure() : "La central cerró el enlace", now);
            break;
        case WStype_ERROR:
            LOG_W("Error del WebSocket");
            break;
        default:
            break;
    }
}

// --- Uploader -----------------------------------------------------------------

Uploader::Uploader(const mining::Settings& settings, mining::VoiceQueue& voices, mining::WallClock& clock, mining::EventQueue& events)
    : settings_(settings), voices_(voices), clock_(clock), events_(events) {
    std::string error;
    mining::parseCentralUrl(settings.connection->url, url_, error);
}

void Uploader::begin() { xTaskCreatePinnedToCore(entry, "mining-voice-upload", 8192, this, 2, &task_, 0); }

void Uploader::wake() {
    if (task_ != nullptr) xTaskNotifyGive(task_);
}

void Uploader::entry(void* self) { static_cast<Uploader*>(self)->run(); }

void Uploader::run() {
    mining::Millis backoff = 2000;
    for (;;) {
        // The recording date needs the central's time, taken from the WebSocket acks.
        if (!wifiConnected() || !clock_.synced()) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(2000));
            continue;
        }
        std::optional<mining::QueuedVoice> voice = voices_.first();
        if (!voice) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(kUploadIdleMs));
            continue;
        }
        std::string detail;
        int status = post(*voice, detail);
        if (status == 200 || status == 201) {
            voices_.remove(*voice);
            events_.push(mining::VoiceEvent{true, voice->id, ""});
            LOG_I("Mensaje de voz %s subido", voice->id.c_str());
            backoff = 2000;
            continue;
        }
        if (std::find(std::begin(kPermanentFailures), std::end(kPermanentFailures), status) != std::end(kPermanentFailures)) {
            voices_.reject(*voice, detail);
            events_.push(mining::VoiceEvent{false, voice->id, detail});
            LOG_W("La central rechazó el audio %s: %s", voice->id.c_str(), detail.c_str());
            backoff = 2000;
            continue;
        }
        LOG_W("Subida de voz pendiente (%d): %s", status, detail.c_str());
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(backoff));
        backoff = std::min(backoff * 2, kUploadMaxBackoffMs);
    }
}

int Uploader::post(const mining::QueuedVoice& voice, std::string& detail) {
    IPAddress address;
    if (!resolveHost(url_.host, address)) {
        detail = "No se encontró " + url_.host;
        return 0;
    }
    FILE* file = fopen(fsPath(voice.audioPath).c_str(), "rb");
    if (file == nullptr) {
        detail = "Audio no disponible";
        return 400;
    }
    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    if (size <= static_cast<long>(mining::kWavHeaderBytes)) {
        fclose(file);
        detail = "Audio vacío";
        return 400;
    }

    std::optional<int64_t> recordedAt = clock_.resolve(voice.stamp);
    if (!recordedAt) recordedAt = clock_.now();
    std::string url = "http://" + std::string(address.toString().c_str()) + ":" + std::to_string(url_.port) + url_.voicePath();
    GainWavStream body(file, static_cast<size_t>(size), mining::normalizationGain(voice.peak));

    WiFiClient client;
    HTTPClient http;
    http.setConnectTimeout(8000);
    http.setTimeout(30000);
    http.setReuse(false);
    if (!http.begin(client, url.c_str())) {
        fclose(file);
        detail = "URL inválida";
        return 0;
    }
    http.addHeader("Content-Type", "audio/wav");
    http.addHeader("X-Device-Key", settings_.connection->apiKey.c_str());
    http.addHeader("X-Client-Message-Id", voice.id.c_str());
    http.addHeader("X-Recorded-At", mining::formatIso(*recordedAt).c_str());
    int status = http.sendRequest("POST", &body, static_cast<size_t>(size));
    if (status <= 0) {
        detail = HTTPClient::errorToString(status).c_str();
        status = 0;
    } else if (status != 200 && status != 201) {
        String response = http.getString();
        JsonDocument json;
        detail = !deserializeJson(json, response) && json["message"].is<const char*>() ? json["message"].as<const char*>()
                                                                                         : ("HTTP " + std::to_string(status));
    }
    http.end();
    fclose(file);
    return status;
}

}  // namespace device
