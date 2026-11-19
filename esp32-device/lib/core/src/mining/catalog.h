// Códigos compartidos con backend/Domain/Catalogs.cs; textos cortos para la OLED.
#pragma once

#include <cstddef>
#include <string>

namespace mining {

struct MessageOption {
    const char* code;
    const char* label;
};

// Reportes que el minero elige en el menú Mensajes.
constexpr size_t kMessageCount = 8;
extern const MessageOption kMessages[kMessageCount];

// Alarmas que la manilla envía sola al alcanzar el umbral de peligro.
constexpr const char* kCoAlarm = "CO_ALARM";
constexpr const char* kHeatAlarm = "HEAT_ALARM";

bool isMessageCode(const std::string& code);
bool isAutomaticMessage(const std::string& code);

}  // namespace mining
