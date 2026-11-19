// Consola por los dos conectores USB de la DevKitC: el UART ("COM", con chip
// USB-serie) y el USB nativo del ESP32-S3 ("USB", USB Serial/JTAG). Las salidas
// van a ambos; si no hay un PC conectado, la escritura no bloquea.
#pragma once

#include <Stream.h>

#include <cstddef>

namespace device {

constexpr size_t kConsoleStreams = 2;

void beginSerial();
void serialWrite(const char* text);
void serialPrintf(const char* format, ...) __attribute__((format(printf, 1, 2)));
Stream& consoleStream(size_t index);

}  // namespace device
