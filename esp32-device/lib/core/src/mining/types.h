// Tipos compartidos por todos los módulos de la manilla.
#pragma once

#include <cstdint>
#include <functional>

namespace mining {

// Milisegundos de un reloj monótono (desde el arranque).
using Millis = int64_t;
using MonotonicClock = std::function<Millis()>;

// Botones de navegación.
enum class Action : uint8_t { Up, Down, Enter };

// Nivel de alerta calculado por la manilla.
enum class Level : uint8_t { Normal = 0, Caution = 1, Danger = 2 };

// Nombre en el protocolo de la central: normal, caution o danger.
const char* levelName(Level level);
// Texto corto para la OLED.
const char* levelLabel(Level level);

}  // namespace mining
