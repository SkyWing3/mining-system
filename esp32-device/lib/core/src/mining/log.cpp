#include "mining/log.h"

#include <cstdarg>
#include <cstdio>

namespace mining {

namespace {
LogSink sink = nullptr;
}

void setLogSink(LogSink value) { sink = value; }

void logf(LogLevel level, const char* format, ...) {
    if (sink == nullptr) return;
    char message[256];
    va_list args;
    va_start(args, format);
    vsnprintf(message, sizeof message, format, args);
    va_end(args);
    sink(level, message);
}

}  // namespace mining
