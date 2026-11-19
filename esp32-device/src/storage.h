// Archivos en LittleFS con operaciones POSIX sobre el punto de montaje (sin
// los mensajes de error que la API File de Arduino imprime para archivos que
// no existen).
#pragma once

#include <cstddef>
#include <string>

#include "mining/file_store.h"

namespace device {

constexpr const char* kMountPoint = "/littlefs";

bool mountStorage();
// Ruta real en el VFS de una ruta lógica ("/out/x.json" -> "/littlefs/out/x.json").
std::string fsPath(const std::string& logical);
size_t storageFreeBytes();
size_t storageTotalBytes();

class LittleFsStore : public mining::FileStore {
public:
    std::vector<std::string> list(const std::string& dir) override;
    bool read(const std::string& path, std::string& out) override;
    bool writeAtomic(const std::string& path, const std::string& data) override;
    bool rename(const std::string& from, const std::string& to) override;
    bool remove(const std::string& path) override;
    bool exists(const std::string& path) override;
    bool makeDir(const std::string& path) override;
    bool appendLine(const std::string& path, const std::string& line, size_t maxBytes) override;
};

}  // namespace device
