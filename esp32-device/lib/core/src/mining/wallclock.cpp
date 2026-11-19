#include "mining/wallclock.h"

#include <cstdio>
#include <cstdlib>

namespace mining {

namespace {
constexpr int64_t kResyncThresholdMs = 1000;

// Howard Hinnant's days_from_civil / civil_from_days.
int64_t daysFromCivil(int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

void civilFromDays(int64_t z, int64_t& y, unsigned& m, unsigned& d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp < 10 ? mp + 3 : mp - 9;
    y = static_cast<int64_t>(yoe) + era * 400 + (m <= 2);
}

bool digits(const std::string& text, size_t at, size_t count, int& out) {
    if (at + count > text.size()) return false;
    out = 0;
    for (size_t i = at; i < at + count; ++i) {
        if (text[i] < '0' || text[i] > '9') return false;
        out = out * 10 + (text[i] - '0');
    }
    return true;
}
}  // namespace

WallClock::WallClock(uint32_t bootId, MonotonicClock uptime) : bootId_(bootId), uptime_(std::move(uptime)) {}

bool WallClock::synced() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return synced_;
}

std::optional<int64_t> WallClock::now() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!synced_) return std::nullopt;
    return uptime_() + offset_;
}

Stamp WallClock::stamp() const {
    std::lock_guard<std::mutex> lock(mutex_);
    Millis uptime = uptime_();
    return Stamp{synced_ ? uptime + offset_ : -1, bootId_, uptime};
}

std::optional<int64_t> WallClock::resolve(const Stamp& stamp) const {
    if (stamp.absolute()) return stamp.epochMs;
    std::lock_guard<std::mutex> lock(mutex_);
    if (!synced_ || stamp.boot != bootId_) return std::nullopt;
    return stamp.uptimeMs + offset_;
}

void WallClock::sync(int64_t serverEpochMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    int64_t offset = serverEpochMs - uptime_();
    if (!synced_ || std::llabs(offset - offset_) > kResyncThresholdMs) {
        offset_ = offset;
        synced_ = true;
    }
}

std::string formatIso(int64_t epochMs) {
    int64_t days = epochMs >= 0 ? epochMs / 86400000 : -((-epochMs + 86399999) / 86400000);
    int64_t ms = epochMs - days * 86400000;
    int64_t year;
    unsigned month, day;
    civilFromDays(days, year, month, day);
    char buffer[32];
    snprintf(buffer, sizeof buffer, "%04lld-%02u-%02uT%02lld:%02lld:%02lld.%03lldZ", static_cast<long long>(year), month, day,
             static_cast<long long>(ms / 3600000), static_cast<long long>(ms / 60000 % 60),
             static_cast<long long>(ms / 1000 % 60), static_cast<long long>(ms % 1000));
    return buffer;
}

bool parseIso(const std::string& text, int64_t& epochMs) {
    int year, month, day, hour, minute, second;
    if (!digits(text, 0, 4, year) || text.size() < 19 || text[4] != '-' || !digits(text, 5, 2, month) || text[7] != '-' ||
        !digits(text, 8, 2, day) || (text[10] != 'T' && text[10] != ' ') || !digits(text, 11, 2, hour) || text[13] != ':' ||
        !digits(text, 14, 2, minute) || text[16] != ':' || !digits(text, 17, 2, second))
        return false;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return false;
    size_t at = 19;
    int64_t millis = 0;
    if (at < text.size() && text[at] == '.') {
        ++at;
        int64_t scale = 100;
        size_t start = at;
        while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
            millis += (text[at] - '0') * scale;
            scale /= 10;
            ++at;
        }
        if (at == start) return false;
    }
    int64_t offsetMinutes = 0;
    if (at < text.size()) {
        if (text[at] == 'Z' && at + 1 == text.size()) {
            ++at;
        } else if ((text[at] == '+' || text[at] == '-') && at + 6 == text.size() && text[at + 3] == ':') {
            int hours, minutes;
            if (!digits(text, at + 1, 2, hours) || !digits(text, at + 4, 2, minutes)) return false;
            offsetMinutes = (hours * 60 + minutes) * (text[at] == '-' ? -1 : 1);
            at += 6;
        } else {
            return false;
        }
    }
    int64_t days = daysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    epochMs = ((days * 24 + hour) * 60 + minute - offsetMinutes) * 60000 + static_cast<int64_t>(second) * 1000 + millis;
    return true;
}

}  // namespace mining
