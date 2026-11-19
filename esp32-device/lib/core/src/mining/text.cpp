#include "mining/text.h"

namespace mining {

namespace {

// Decodes one UTF-8 sequence starting at `index`; returns the code point and advances `index`.
// Invalid bytes are returned as U+FFFD and consume a single byte.
uint32_t decode(const std::string& text, size_t& index) {
    const auto byte = [&](size_t at) { return static_cast<uint8_t>(text[at]); };
    uint8_t lead = byte(index);
    size_t length = lead < 0x80 ? 1 : (lead >> 5) == 0x6 ? 2 : (lead >> 4) == 0xE ? 3 : (lead >> 3) == 0x1E ? 4 : 0;
    if (length == 0 || index + length > text.size()) {
        index += 1;
        return 0xFFFD;
    }
    uint32_t code = length == 1 ? lead : lead & (0xFF >> (length + 1));
    for (size_t offset = 1; offset < length; ++offset) {
        uint8_t next = byte(index + offset);
        if ((next & 0xC0) != 0x80) {
            index += 1;
            return 0xFFFD;
        }
        code = (code << 6) | (next & 0x3F);
    }
    index += length;
    return code;
}

void encode(uint32_t code, std::string& out) {
    if (code < 0x80) {
        out += static_cast<char>(code);
    } else if (code < 0x800) {
        out += static_cast<char>(0xC0 | (code >> 6));
        out += static_cast<char>(0x80 | (code & 0x3F));
    } else {
        out += static_cast<char>(0xE0 | (code >> 12));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
    }
}

}  // namespace

std::string oledText(const std::string& utf8) {
    std::string out;
    out.reserve(utf8.size());
    for (size_t index = 0; index < utf8.size();) {
        uint32_t code = decode(utf8, index);
        if (code == '\t' || code == '\n' || code == '\r') {
            out += ' ';
        } else if ((code >= 0x20 && code < 0x7F) || (code >= 0xA0 && code <= 0xFF)) {
            encode(code, out);
        } else if (code == 0x2018 || code == 0x2019) {
            out += '\'';
        } else if (code == 0x201C || code == 0x201D) {
            out += '"';
        } else if (code == 0x2013 || code == 0x2014) {
            out += '-';
        } else if (code == 0x2026) {
            out += "...";
        }
        // Anything else has no glyph in the OLED font and is dropped.
    }
    return out;
}

std::string utf8Prefix(const std::string& utf8, size_t count) {
    size_t index = 0;
    for (size_t taken = 0; taken < count && index < utf8.size(); ++taken) decode(utf8, index);
    return utf8.substr(0, index);
}

size_t utf8Length(const std::string& utf8) {
    size_t count = 0;
    for (size_t index = 0; index < utf8.size(); ++count) decode(utf8, index);
    return count;
}

std::vector<std::string> splitWords(const std::string& text) {
    std::vector<std::string> words;
    std::string current;
    for (char c : text) {
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            if (!current.empty()) words.push_back(current), current.clear();
        } else {
            current += c;
        }
    }
    if (!current.empty()) words.push_back(current);
    return words;
}

std::string randomHexId(const std::function<uint32_t()>& random) {
    static const char digits[] = "0123456789abcdef";
    std::string id;
    id.reserve(32);
    for (int word = 0; word < 4; ++word) {
        uint32_t value = random();
        for (int nibble = 7; nibble >= 0; --nibble) id += digits[(value >> (nibble * 4)) & 0xF];
    }
    return id;
}

bool isHexId(const std::string& value, size_t length) {
    if (value.size() != length) return false;
    for (char c : value) {
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

}  // namespace mining
