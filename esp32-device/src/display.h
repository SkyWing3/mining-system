// OLED SSD1306 128x64 por I2C con U8g2.
#pragma once

#include <U8g2lib.h>

#include <string>

#include "mining/app.h"
#include "mining/canvas.h"
#include "mining/settings.h"

namespace device {

class U8g2Canvas : public mining::Canvas {
public:
    explicit U8g2Canvas(U8G2& u8g2) : u8g2_(u8g2) {}

    void clear() override;
    void setFont(mining::Font font) override;
    int textWidth(const std::string& utf8) override;
    void text(int x, int y, const std::string& utf8, bool on) override;
    void box(int x0, int y0, int x1, int y1, bool on) override;
    void frame(int x0, int y0, int x1, int y1, bool on) override;
    void roundedFrame(int x0, int y0, int x1, int y1, int radius, bool on) override;
    void line(int x0, int y0, int x1, int y1, bool on) override;
    void ellipse(int x0, int y0, int x1, int y1, bool filled, bool on) override;

private:
    U8G2& u8g2_;
    mining::Font font_ = mining::Font::Small;
};

class Display {
public:
    void begin(const mining::DisplayConfig& config, uint32_t busClock);
    // Draws the menu and sends it to the OLED only when the frame changed.
    void show(mining::Application& app);
    // Full-screen message, for example an invalid configuration.
    void message(const std::string& title, const std::string& body);

private:
    void send();

    U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2_{U8G2_R0, U8X8_PIN_NONE};
    U8g2Canvas canvas_{u8g2_};
    uint8_t last_[1024] = {};
    bool hasLast_ = false;
};

}  // namespace device
