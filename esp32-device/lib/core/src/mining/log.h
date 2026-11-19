// Registro mínimo: el firmware lo dirige a la consola serie y las pruebas a stdout.
#pragma once

namespace mining {

enum class LogLevel { Debug, Info, Warning, Error };

using LogSink = void (*)(LogLevel level, const char* message);

void setLogSink(LogSink sink);
void logf(LogLevel level, const char* format, ...) __attribute__((format(printf, 2, 3)));

}  // namespace mining

#define LOG_D(...) ::mining::logf(::mining::LogLevel::Debug, __VA_ARGS__)
#define LOG_I(...) ::mining::logf(::mining::LogLevel::Info, __VA_ARGS__)
#define LOG_W(...) ::mining::logf(::mining::LogLevel::Warning, __VA_ARGS__)
#define LOG_E(...) ::mining::logf(::mining::LogLevel::Error, __VA_ARGS__)
