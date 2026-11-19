#include "storage.h"

#include <LittleFS.h>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>

#include "mining/log.h"

namespace device {

bool mountStorage() {
    // The partition is named "spiffs" so that "pio run -t uploadfs" finds it too.
    if (LittleFS.begin(true, kMountPoint, 10, "spiffs")) return true;
    LOG_E("No se pudo montar LittleFS");
    return false;
}

std::string fsPath(const std::string& logical) { return std::string(kMountPoint) + logical; }

size_t storageFreeBytes() {
    size_t total = LittleFS.totalBytes(), used = LittleFS.usedBytes();
    return total > used ? total - used : 0;
}

size_t storageTotalBytes() { return LittleFS.totalBytes(); }

std::vector<std::string> LittleFsStore::list(const std::string& dir) {
    std::vector<std::string> names;
    DIR* handle = opendir(fsPath(dir).c_str());
    if (handle == nullptr) return names;
    while (dirent* entry = readdir(handle)) {
        if (entry->d_type == DT_DIR) continue;
        names.emplace_back(entry->d_name);
    }
    closedir(handle);
    return names;
}

bool LittleFsStore::read(const std::string& path, std::string& out) {
    FILE* file = fopen(fsPath(path).c_str(), "rb");
    if (file == nullptr) return false;
    out.clear();
    char buffer[256];
    size_t count;
    while ((count = fread(buffer, 1, sizeof buffer, file)) > 0) out.append(buffer, count);
    bool ok = !ferror(file);
    fclose(file);
    return ok;
}

bool LittleFsStore::writeAtomic(const std::string& path, const std::string& data) {
    std::string target = fsPath(path), temporary = target + ".tmp";
    FILE* file = fopen(temporary.c_str(), "wb");
    if (file == nullptr) return false;
    bool ok = fwrite(data.data(), 1, data.size(), file) == data.size();
    ok = fflush(file) == 0 && ok;
    ok = fsync(fileno(file)) == 0 && ok;
    ok = fclose(file) == 0 && ok;
    // LittleFS renames atomically: the entry is either the old one or the complete new one.
    if (ok) ok = ::rename(temporary.c_str(), target.c_str()) == 0;
    if (!ok) unlink(temporary.c_str());
    return ok;
}

bool LittleFsStore::rename(const std::string& from, const std::string& to) {
    return ::rename(fsPath(from).c_str(), fsPath(to).c_str()) == 0;
}

bool LittleFsStore::remove(const std::string& path) { return unlink(fsPath(path).c_str()) == 0; }

bool LittleFsStore::exists(const std::string& path) {
    struct stat info;
    return stat(fsPath(path).c_str(), &info) == 0;
}

bool LittleFsStore::makeDir(const std::string& path) {
    struct stat info;
    if (stat(fsPath(path).c_str(), &info) == 0) return S_ISDIR(info.st_mode);
    return mkdir(fsPath(path).c_str(), 0700) == 0;
}

bool LittleFsStore::appendLine(const std::string& path, const std::string& line, size_t maxBytes) {
    std::string target = fsPath(path);
    struct stat info;
    if (stat(target.c_str(), &info) == 0 && static_cast<size_t>(info.st_size) + line.size() + 1 > maxBytes) {
        std::string old = target + ".old";
        unlink(old.c_str());
        ::rename(target.c_str(), old.c_str());
    }
    FILE* file = fopen(target.c_str(), "ab");
    if (file == nullptr) return false;
    bool ok = fwrite(line.data(), 1, line.size(), file) == line.size() && fputc('\n', file) != EOF;
    return fclose(file) == 0 && ok;
}

}  // namespace device
