// Hora real de la manilla.
//
// El ESP32 no tiene reloj de tiempo real y en la mina no suele haber NTP: la
// hora se toma del campo `serverTime` de cada ack de la central. Lo que se
// guarda antes de la primera sincronización lleva el número de arranque y el
// tiempo desde el arranque; al enviarlo se convierte a fecha si sigue siendo el
// mismo arranque.
#pragma once

#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

#include "mining/types.h"

namespace mining {

struct Stamp {
    // Epoch in milliseconds, or -1 when the clock was not synchronized.
    int64_t epochMs = -1;
    uint32_t boot = 0;
    Millis uptimeMs = 0;

    bool absolute() const { return epochMs >= 0; }
};

class WallClock {
public:
    WallClock(uint32_t bootId, MonotonicClock uptime);

    uint32_t bootId() const { return bootId_; }
    bool synced() const;
    std::optional<int64_t> now() const;
    Stamp stamp() const;
    std::optional<int64_t> resolve(const Stamp& stamp) const;
    // Adopts the central's time; small differences (latency) are ignored.
    void sync(int64_t serverEpochMs);

private:
    uint32_t bootId_;
    MonotonicClock uptime_;
    mutable std::mutex mutex_;
    bool synced_ = false;
    int64_t offset_ = 0;
};

// 2026-11-16T19:04:05.123Z
std::string formatIso(int64_t epochMs);
// Acepta fracciones de cualquier longitud y zona Z, ±hh:mm o ninguna (UTC).
bool parseIso(const std::string& text, int64_t& epochMs);

}  // namespace mining
