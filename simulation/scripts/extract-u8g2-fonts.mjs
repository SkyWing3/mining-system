// Extrae de U8g2 las fuentes que usa la OLED de la manilla (display.cpp:
// u8g2_font_helvR08_tf y u8g2_font_helvR10_tf) y las guarda, sin modificar, en
// packages/device-sim/src/fonts/helvetica.ts. Así el gemelo dibuja la pantalla con los
// mismos glifos que la placa, sin depender de que esté descargada la librería.
//
// Uso: node scripts/extract-u8g2-fonts.mjs [ruta a U8g2/src/clib/u8g2_fonts.c]
// Por defecto usa la copia que descarga PlatformIO en esp32-device/.pio/libdeps.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FONTS = ['u8g2_font_helvR08_tf', 'u8g2_font_helvR10_tf']

function defaultSource() {
  const base = fileURLToPath(new URL('../../esp32-device/.pio/libdeps/', import.meta.url))
  for (const env of readdirSync(base)) {
    const candidate = join(base, env, 'U8g2/src/clib/u8g2_fonts.c')
    try { readFileSync(candidate, { flag: 'r' }); return candidate } catch { /* siguiente entorno */ }
  }
  throw new Error('No se encontró U8g2. Compila esp32-device con PlatformIO o indica la ruta de u8g2_fonts.c.')
}

/** Bytes de un literal de cadena de C (con escapes octales y estándar). */
function parseCString(body) {
  const bytes = []
  for (let index = 0; index < body.length; index++) {
    const char = body[index]
    if (char !== '\\') { bytes.push(char.charCodeAt(0)); continue }
    const next = body[++index]
    if (next >= '0' && next <= '7') {
      let digits = next
      while (digits.length < 3 && body[index + 1] >= '0' && body[index + 1] <= '7') digits += body[++index]
      bytes.push(parseInt(digits, 8))
    } else if (next === 'x') {
      let digits = ''
      while (/[0-9a-fA-F]/.test(body[index + 1] ?? '')) digits += body[++index]
      bytes.push(parseInt(digits, 16))
    } else {
      const simple = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34, "'": 39, '?': 63 }[next]
      if (simple === undefined) throw new Error(`Escape desconocido \\${next}`)
      bytes.push(simple)
    }
  }
  return bytes
}

function extract(source, name) {
  const start = source.indexOf(`const uint8_t ${name}[`)
  if (start < 0) throw new Error(`No se encontró ${name}.`)
  const size = Number(source.slice(start).match(/\[(\d+)\]/)[1])
  // Literales concatenados hasta el «;» que cierra la declaración (los datos también contienen «;»).
  const bytes = []
  let index = source.indexOf('=', start) + 1
  for (;;) {
    while (/\s/.test(source[index])) index++
    if (source[index] === ';') break
    if (source[index] !== '"') throw new Error(`${name}: carácter inesperado «${source[index]}».`)
    let end = index + 1
    while (source[end] !== '"') end += source[end] === '\\' ? 2 : 1
    bytes.push(...parseCString(source.slice(index + 1, end)))
    index = end + 1
  }
  // El arreglo de C incluye el terminador nulo de la cadena.
  if (bytes.length + 1 !== size) throw new Error(`${name}: ${bytes.length + 1} bytes leídos, se esperaban ${size}.`)
  return Buffer.from(bytes)
}

const path = process.argv[2] ?? defaultSource()
const source = readFileSync(path, 'latin1')
const version = (() => {
  try { return readFileSync(join(path, '../../../library.properties'), 'utf8').match(/^version=(.+)$/m)?.[1] ?? 'desconocida' } catch { return 'desconocida' }
})()
const entries = FONTS.map(name => `/** \`${name}\` (${extract(source, name).length} bytes). */\nexport const ${name.replace('u8g2_font_', '')} = '${extract(source, name).toString('base64')}'`)

writeFileSync(new URL('../packages/device-sim/src/fonts/helvetica.ts', import.meta.url), `// Generado por scripts/extract-u8g2-fonts.mjs a partir de U8g2 ${version}. No editar a mano.
//
// Fuentes de la OLED de la manilla (esp32-device/src/display.cpp), en el formato
// comprimido de U8g2 y codificadas en base64. Derivan de las fuentes bitmap X11
// HELVR08.BDF y HELVR10.BDF, con esta licencia:
//
// Copyright 1984-1989, 1994 Adobe Systems Incorporated.
// Copyright 1988, 1994 Digital Equipment Corporation.
//
// Adobe is a trademark of Adobe Systems Incorporated which may be
// registered in certain jurisdictions.
// Permission to use these trademarks is hereby granted only in
// association with the images described in this file.
//
// Permission to use, copy, modify, distribute and sell this software
// and its documentation for any purpose and without fee is hereby
// granted, provided that the above copyright notices appear in all
// copies and that both those copyright notices and this permission
// notice appear in supporting documentation, and that the names of
// Adobe Systems and Digital Equipment Corporation not be used in
// advertising or publicity pertaining to distribution of the software
// without specific, written prior permission.  Adobe Systems and
// Digital Equipment Corporation make no representations about the
// suitability of this software for any purpose.  It is provided "as
// is" without express or implied warranty.

${entries.join('\n\n')}
`)
console.log(`Fuentes extraídas de ${path} (U8g2 ${version}).`)
