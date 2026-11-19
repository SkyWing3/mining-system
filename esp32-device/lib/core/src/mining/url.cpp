#include "mining/url.h"

#include <cstdlib>

namespace mining {

namespace {
constexpr const char* kSocketSuffix = "/ws/device";

bool endsWith(const std::string& value, const std::string& suffix) {
    return value.size() >= suffix.size() && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}
}  // namespace

std::string CentralUrl::voicePath() const {
    std::string base = endsWith(path, kSocketSuffix) ? path.substr(0, path.size() - std::string(kSocketSuffix).size()) : "";
    return base + "/api/device/voice";
}

bool parseCentralUrl(const std::string& url, CentralUrl& out, std::string& error) {
    const std::string scheme = "ws://";
    if (url.compare(0, 6, "wss://") == 0) {
        error = "connection.url: wss:// aún no está disponible en el ESP32; usa ws:// en la red local.";
        return false;
    }
    if (url.compare(0, scheme.size(), scheme) != 0) {
        error = "connection.url debe ser una dirección ws:// sin credenciales.";
        return false;
    }
    std::string rest = url.substr(scheme.size());
    size_t slash = rest.find('/');
    std::string authority = rest.substr(0, slash);
    std::string path = slash == std::string::npos ? "/" : rest.substr(slash);
    size_t cut = path.find_first_of("?#");
    if (cut != std::string::npos) path = path.substr(0, cut);
    if (path.empty()) path = "/";

    if (authority.empty() || authority.find('@') != std::string::npos || authority.find('[') != std::string::npos ||
        authority.find_first_of(" \t") != std::string::npos) {
        error = "connection.url debe ser una dirección ws:// sin credenciales.";
        return false;
    }
    std::string host = authority;
    long port = 80;
    size_t colon = authority.rfind(':');
    if (colon != std::string::npos) {
        host = authority.substr(0, colon);
        std::string digits = authority.substr(colon + 1);
        char* end = nullptr;
        port = digits.empty() ? 0 : std::strtol(digits.c_str(), &end, 10);
        if (digits.empty() || *end != '\0' || port < 1 || port > 65535) {
            error = "connection.url: puerto inválido.";
            return false;
        }
    }
    if (host.empty()) {
        error = "connection.url debe incluir el host de la central.";
        return false;
    }
    out.host = host;
    out.port = static_cast<uint16_t>(port);
    out.path = path;
    return true;
}

}  // namespace mining
