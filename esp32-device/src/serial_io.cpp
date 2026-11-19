#include "serial_io.h"

#include <Arduino.h>

#include <cstdarg>
#include <cstdio>

namespace device {

void beginSerial() {
    Serial.setRxBufferSize(4096);
    Serial.begin(115200);
    USBSerial.setRxBufferSize(4096);
    // Without a host reading, the USB port drops output instead of stalling the tasks.
    USBSerial.setTxTimeoutMs(0);
    USBSerial.begin();
}

void serialWrite(const char* text) {
    Serial.print(text);
    USBSerial.print(text);
}

void serialPrintf(const char* format, ...) {
    char buffer[384];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof buffer, format, args);
    va_end(args);
    serialWrite(buffer);
}

Stream& consoleStream(size_t index) {
    if (index == 0) return Serial;
    return USBSerial;
}

}  // namespace device
