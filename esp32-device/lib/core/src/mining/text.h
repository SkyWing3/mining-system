// Utilidades de texto UTF-8 para la OLED y para las tramas.
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace mining {

// Conserva ASCII y Latin-1 (tildes, ñ, °), que la fuente de la OLED sí dibuja;
// cambia comillas y guiones tipográficos por ASCII y descarta lo demás.
std::string oledText(const std::string& utf8);

// Primeros `count` caracteres (no bytes) sin cortar una secuencia UTF-8.
std::string utf8Prefix(const std::string& utf8, size_t count);

// Número de caracteres UTF-8.
size_t utf8Length(const std::string& utf8);

// Palabras separadas por espacios en blanco.
std::vector<std::string> splitWords(const std::string& text);

// Hexadecimal en minúsculas de 32 caracteres a partir de 16 bytes aleatorios.
std::string randomHexId(const std::function<uint32_t()>& random);

bool isHexId(const std::string& value, size_t length = 32);

}  // namespace mining
