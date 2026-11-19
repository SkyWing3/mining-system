// Acceso a archivos que usan las colas durables. En el ESP32 se implementa con
// LittleFS (escritura atómica por archivo temporal + rename); en las pruebas,
// con un mapa en memoria.
#pragma once

#include <cstddef>
#include <map>
#include <string>
#include <vector>

namespace mining {

class FileStore {
public:
    virtual ~FileStore() = default;
    // Names (not paths) of the files directly inside `dir`.
    virtual std::vector<std::string> list(const std::string& dir) = 0;
    virtual bool read(const std::string& path, std::string& out) = 0;
    // Temporary file, then rename: never a half-written entry.
    virtual bool writeAtomic(const std::string& path, const std::string& data) = 0;
    virtual bool rename(const std::string& from, const std::string& to) = 0;
    virtual bool remove(const std::string& path) = 0;
    virtual bool exists(const std::string& path) = 0;
    virtual bool makeDir(const std::string& path) = 0;
    // Appends a line, rotating the file to `<path>.old` when it exceeds `maxBytes`.
    virtual bool appendLine(const std::string& path, const std::string& line, size_t maxBytes) = 0;
};

// Implementación en memoria para pruebas y diagnóstico.
class MemoryStore : public FileStore {
public:
    std::map<std::string, std::string> files;
    bool failWrites = false;

    std::vector<std::string> list(const std::string& dir) override {
        std::vector<std::string> names;
        std::string prefix = dir + "/";
        for (const auto& entry : files) {
            const std::string& path = entry.first;
            if (path.compare(0, prefix.size(), prefix) == 0 && path.find('/', prefix.size()) == std::string::npos)
                names.push_back(path.substr(prefix.size()));
        }
        return names;
    }
    bool read(const std::string& path, std::string& out) override {
        auto found = files.find(path);
        if (found == files.end()) return false;
        out = found->second;
        return true;
    }
    bool writeAtomic(const std::string& path, const std::string& data) override {
        if (failWrites) return false;
        files[path] = data;
        return true;
    }
    bool rename(const std::string& from, const std::string& to) override {
        auto found = files.find(from);
        if (found == files.end() || failWrites) return false;
        files[to] = found->second;
        files.erase(from);
        return true;
    }
    bool remove(const std::string& path) override { return files.erase(path) > 0; }
    bool exists(const std::string& path) override { return files.count(path) > 0; }
    bool makeDir(const std::string&) override { return true; }
    bool appendLine(const std::string& path, const std::string& line, size_t maxBytes) override {
        std::string& content = files[path];
        if (content.size() + line.size() + 1 > maxBytes) {
            files[path + ".old"] = content;
            content.clear();
        }
        content += line + "\n";
        return true;
    }
};

}  // namespace mining
