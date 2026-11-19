// Superficie de dibujo monocroma de 128x64. Las coordenadas incluyen ambos
// extremos, como en Pillow; `y` del texto es su borde superior.
#pragma once

#include <string>

namespace mining {

enum class Font { Small, Large };

class Canvas {
public:
    virtual ~Canvas() = default;
    virtual void clear() = 0;
    virtual void setFont(Font font) = 0;
    virtual int textWidth(const std::string& utf8) = 0;
    virtual void text(int x, int y, const std::string& utf8, bool on) = 0;
    virtual void box(int x0, int y0, int x1, int y1, bool on) = 0;
    virtual void frame(int x0, int y0, int x1, int y1, bool on) = 0;
    virtual void roundedFrame(int x0, int y0, int x1, int y1, int radius, bool on) = 0;
    virtual void line(int x0, int y0, int x1, int y1, bool on) = 0;
    virtual void ellipse(int x0, int y0, int x1, int y1, bool filled, bool on) = 0;
};

}  // namespace mining
