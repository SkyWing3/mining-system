// Fotograma de la OLED SSD1306 de 128x64 (display/renderer.py).
#pragma once

#include <string>
#include <vector>

#include "mining/canvas.h"
#include "mining/menu.h"

namespace mining {

class Renderer {
public:
    void render(const Menu& menu, Canvas& canvas);

private:
    void header(const Menu& menu);
    void main(const Menu& menu);
    void messages(const Menu& menu);
    void voice(const Menu& menu);
    void noticeOverlay(const Menu& menu);
    void alarmOverlay(const Menu& menu);
    std::string footer(const Menu& menu) const;
    std::vector<std::string> detail(const Menu& menu) const;

    void text(int x, int y, const std::string& value, bool on = true);
    void footerText(const std::string& value);
    void lines(const std::vector<std::string>& values);
    void options(const std::vector<std::string>& items, int selected, int offset, int rows, int top = 15);
    void banner(const std::string& value);
    void wrapped(const std::string& value, int top);
    void scrollbar(int selected, int count);
    void icon(int index, int x, int y, bool on);

    Canvas* canvas_ = nullptr;
};

std::string linkText(const Menu& menu);
std::string clockText(int seconds);

}  // namespace mining
