// Dirección de la central: ws://host[:puerto]/ruta.
#pragma once

#include <cstdint>
#include <string>

namespace mining {

struct CentralUrl {
    std::string host;
    uint16_t port = 80;
    // Ruta del WebSocket, por ejemplo /ws/device.
    std::string path = "/";

    // Ruta HTTP de la subida de voz en el mismo host (como ConnectionConfig.voice_url en Python).
    std::string voicePath() const;
};

// Solo admite ws:// (la central está en la red local); rechaza credenciales en la URL.
bool parseCentralUrl(const std::string& url, CentralUrl& out, std::string& error);

}  // namespace mining
