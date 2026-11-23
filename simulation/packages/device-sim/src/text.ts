// Utilidades de texto para la OLED y para las tramas (text.cpp).
//
// En el firmware el texto es UTF-8; aquí se trabaja con cadenas de JavaScript y
// se cuentan puntos de código, que equivalen a los caracteres UTF-8.

/**
 * Conserva ASCII y Latin-1 (tildes, ñ, °), que la fuente de la OLED sí dibuja;
 * cambia comillas y guiones tipográficos por ASCII y descarta lo demás.
 */
export function oledText(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += ' '
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) out += char
    else if (code === 0x2018 || code === 0x2019) out += "'"
    else if (code === 0x201c || code === 0x201d) out += '"'
    else if (code === 0x2013 || code === 0x2014) out += '-'
    else if (code === 0x2026) out += '...'
    // Lo demás no tiene glifo en la fuente de la OLED y se descarta.
  }
  return out
}

/** Primeros `count` caracteres (no unidades UTF-16) sin cortar un carácter. */
export function utf8Prefix(text: string, count: number): string {
  let out = ''
  let taken = 0
  for (const char of text) {
    if (taken >= count) break
    out += char
    taken += 1
  }
  return out
}

/** Número de caracteres (puntos de código). */
export function utf8Length(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/** Palabras separadas por espacios en blanco. */
export function splitWords(text: string): string[] {
  return text.split(/[ \t\n\r]+/).filter(word => word.length > 0)
}

/** Hexadecimal en minúsculas de 32 caracteres a partir de 4 palabras aleatorias de 32 bits. */
export function randomHexId(random: () => number): string {
  let id = ''
  for (let word = 0; word < 4; word++) id += (random() >>> 0).toString(16).padStart(8, '0')
  return id
}

export function isHexId(value: string, length = 32): boolean {
  return value.length === length && /^[0-9a-f]*$/.test(value)
}

/** Equivalente de printf("%.Nf"): redondeo con N decimales. */
export function fixed(value: number, decimals: number): string {
  return value.toFixed(decimals)
}
