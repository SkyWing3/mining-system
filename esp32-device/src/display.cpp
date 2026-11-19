#include "display.h"

#include <cstring>

#include "hardware.h"
#include "mining/text.h"

namespace device {

namespace {
// Pillow places text by the top of its line box; U8g2 by the top of a capital
// letter. These offsets keep the layout of display/renderer.py.
constexpr int kSmallOffset = 2;
constexpr int kLargeOffset = 1;
}  // namespace

void U8g2Canvas::clear() { u8g2_.clearBuffer(); }

void U8g2Canvas::setFont(mining::Font font) {
    font_ = font;
    u8g2_.setFont(font == mining::Font::Large ? u8g2_font_helvR10_tf : u8g2_font_helvR08_tf);
}

int U8g2Canvas::textWidth(const std::string& utf8) { return u8g2_.getUTF8Width(utf8.c_str()); }

void U8g2Canvas::text(int x, int y, const std::string& utf8, bool on) {
    u8g2_.setDrawColor(on ? 1 : 0);
    u8g2_.drawUTF8(x, y + (font_ == mining::Font::Large ? kLargeOffset : kSmallOffset), utf8.c_str());
}

void U8g2Canvas::box(int x0, int y0, int x1, int y1, bool on) {
    u8g2_.setDrawColor(on ? 1 : 0);
    u8g2_.drawBox(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

void U8g2Canvas::frame(int x0, int y0, int x1, int y1, bool on) {
    u8g2_.setDrawColor(on ? 1 : 0);
    u8g2_.drawFrame(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

void U8g2Canvas::roundedFrame(int x0, int y0, int x1, int y1, int radius, bool on) {
    int width = x1 - x0 + 1, height = y1 - y0 + 1;
    // U8g2 requires the radius to fit inside the frame.
    int limit = (std::min(width, height) - 2) / 2;
    u8g2_.setDrawColor(on ? 1 : 0);
    u8g2_.drawRFrame(x0, y0, width, height, std::max(0, std::min(radius, limit)));
}

void U8g2Canvas::line(int x0, int y0, int x1, int y1, bool on) {
    u8g2_.setDrawColor(on ? 1 : 0);
    u8g2_.drawLine(x0, y0, x1, y1);
}

void U8g2Canvas::ellipse(int x0, int y0, int x1, int y1, bool filled, bool on) {
    int rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    int cx = x0 + rx, cy = y0 + ry;
    u8g2_.setDrawColor(on ? 1 : 0);
    if (rx == ry) {
        if (filled) {
            u8g2_.drawDisc(cx, cy, rx);
        } else {
            u8g2_.drawCircle(cx, cy, rx);
        }
    } else if (filled) {
        u8g2_.drawFilledEllipse(cx, cy, rx, ry);
    } else {
        u8g2_.drawEllipse(cx, cy, rx, ry);
    }
}

void Display::begin(const mining::DisplayConfig& config, uint32_t busClock) {
    I2cLock lock;
    // U8g2 sets the bus clock before every transfer; keep the one the MLX90614 accepts.
    u8g2_.setBusClock(busClock);
    u8g2_.setI2CAddress(config.address << 1);
    u8g2_.begin();
    u8g2_.setDisplayRotation(config.rotate == 2 ? U8G2_R2 : U8G2_R0);
    u8g2_.setFontMode(1);
    u8g2_.setFontPosTop();
    u8g2_.enableUTF8Print();
    canvas_.setFont(mining::Font::Small);
}

void Display::show(mining::Application& app) {
    app.render(canvas_);
    send();
}

void Display::message(const std::string& title, const std::string& body) {
    canvas_.clear();
    canvas_.setFont(mining::Font::Small);
    canvas_.box(0, 0, 127, 12, true);
    canvas_.text(3, 0, mining::oledText(title), false);
    // Simple word wrap of the body in four lines.
    std::string line;
    int y = 15;
    for (const std::string& word : mining::splitWords(mining::oledText(body))) {
        std::string candidate = line.empty() ? word : line + " " + word;
        if (!line.empty() && canvas_.textWidth(candidate) > 124) {
            canvas_.text(2, y, line, true);
            y += 12;
            line = word;
            if (y > 51) break;
        } else {
            line = candidate;
        }
    }
    if (y <= 51 && !line.empty()) canvas_.text(2, y, line, true);
    send();
}

void Display::send() {
    const uint8_t* buffer = u8g2_.getBufferPtr();
    size_t size = 8u * u8g2_.getBufferTileHeight() * u8g2_.getBufferTileWidth();
    if (size > sizeof last_) size = sizeof last_;
    if (hasLast_ && std::memcmp(buffer, last_, size) == 0) return;
    std::memcpy(last_, buffer, size);
    hasLast_ = true;
    I2cLock lock;
    u8g2_.sendBuffer();
}

}  // namespace device
