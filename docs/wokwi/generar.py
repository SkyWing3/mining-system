#!/usr/bin/env python3
"""Genera el diagrama Wokwi y su vista de cableado a partir del PDF del proyecto.

Ejecutar con Python 3, sin dependencias. Las conexiones se definen una sola vez;
el SVG y la vista HTML se dibujan leyendo el diagram.json generado.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
COLORS = {
    "power": "#d97706", "ground": "#475569", "sda": "#2563eb",
    "scl": "#0891b2", "buttons": "#16a34a", "i2s": "#9333ea",
    "alerts": "#0d9488", "analog": "#e11d48",
}

# Pares físicos del conector GPIO, vistos desde arriba, pin 1 arriba a la izquierda.
HEADER = [
    ("P1_3V3", "P2_5V"), ("P3_GPIO2_SDA", "P4_5V"),
    ("P5_GPIO3_SCL", "P6_GND"), ("P7_GPIO4", "P8_GPIO14"),
    ("P9_GND", "P10_GPIO15"), ("P11_GPIO17", "P12_GPIO18_SCK"),
    ("P13_GPIO27", "P14_GND"), ("P15_GPIO22", "P16_GPIO23"),
    ("P17_3V3", "P18_GPIO24"), ("P19_GPIO10", "P20_GND"),
    ("P21_GPIO9", "P22_GPIO25"), ("P23_GPIO11", "P24_GPIO8"),
    ("P25_GND", "P26_GPIO7"), ("P27_GPIO0_ID_SD", "P28_GPIO1_ID_SC"),
    ("P29_GPIO5", "P30_GND"), ("P31_GPIO6", "P32_GPIO12"),
    ("P33_GPIO13", "P34_GND"), ("P35_GPIO19_WS", "P36_GPIO16_RESERVED"),
    ("P37_GPIO26", "P38_GPIO20_SD"), ("P39_GND", "P40_GPIO21_RESERVED"),
]

# Wokwi representa los chips personalizados como encapsulados DIP: izquierda
# de arriba abajo y derecha de abajo arriba. Los nombres Pn conservan el pin físico.
CHIPS = {
    "rpi-zero-2w": ("Raspberry Pi Zero 2 W · GPIO 40 pines", [p[0] for p in HEADER] + [p[1] for p in reversed(HEADER)]),
    "power-rails": ("Distribución común 3,3 V / GND", ["3V3", "GND"]),
    "ads1115": ("ADS1115 · 0x48", ["VDD", "GND", "SCL", "SDA", "ADDR", "ALRT", "A0", "A1", "A2", "A3"]),
    "sen0564": ("SEN0564 · sensor CO", ["A", "VCC", "GND"]),
    "mlx90614": ("MLX90614 · 0x5A · variante 3,3 V", ["VIN", "GND", "SCL", "SDA"]),
    "inmp441": ("INMP441 · micrófono I2S", ["VDD", "GND", "SCK", "WS", "SD", "L/R"]),
    "active-buzzer": ("Buzzer activo · módulo de 3 pines", ["VCC", "GND", "IO"]),
    "vibration-motor": ("Micro motor vibrador · 3 V", ["POS", "NEG"]),
    "npn": ("2N2222A · transistor NPN", ["B", "C", "E"]),
    "flyback-diode": ("1N4148 · rueda libre", ["A", "K"]),
    "ceramic-capacitor": ("100 nF · filtro del motor", ["1", "2"]),
}


def write_json(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def generate_project():
    parts, wires = [], []

    def part(kind, ident, x, y, **attrs):
        parts.append({"type": kind, "id": ident, "top": y, "left": x, "attrs": attrs})

    def text(ident, x, y, value):
        part("wokwi-text", ident, x, y, text=value)

    def wire(a, b, color, route=None):
        wires.append([a, b, COLORS[color], route or []])

    text("title", 100, 0, "MINING SYSTEM · Manilla inteligente para mineros")
    text("scope", 100, 40, "Cableado según docs/conexiones.pdf · Pi Zero 2 W · GPIO BCM y pin físico")
    part("chip-rpi-zero-2w", "pi", 780, 450)
    part("chip-power-rails", "rails", 80, 310)
    part("board-ssd1306", "oled", 110, 150, i2cAddress="0x3c")
    part("chip-ads1115", "adc", 530, 130)
    part("chip-sen0564", "co", 1010, 130)
    part("chip-mlx90614", "temp", 1470, 130)
    part("chip-inmp441", "mic", 1450, 1010)
    part("chip-active-buzzer", "buzzer", 1450, 450)
    part("chip-vibration-motor", "motor", 1530, 680)
    part("chip-npn", "q1", 1500, 850)
    part("chip-flyback-diode", "d1", 1240, 680)
    part("chip-ceramic-capacitor", "c1", 1770, 680)
    for ident, y, color in [("up", 530, "green"), ("down", 630, "blue"), ("enter", 730, "yellow")]:
        part("wokwi-pushbutton-6mm", ident, 290, y, color=color, bounce="1")
    part("wokwi-rgb-led", "rgb", 170, 1080, common="cathode")
    for ident, value, x, y in [
        ("rb", "1000", 1230, 885), ("rpd", "10000", 1400, 970),
        ("rr", "220", 430, 1050), ("rg", "100", 430, 1110),
        ("rblue", "100", 430, 1170),
    ]:
        part("wokwi-resistor", ident, x, y, value=value)

    text("buttons_label", 120, 460, "BOTONES: Subir / Bajar / Enter\nPull-up internos; cada pulsador cierra a GND")
    text("rgb_label", 110, 1000, "LED RGB · cátodo común\nResistencias externas si el módulo no las integra")
    text("motor_label", 1220, 600, "MOTOR: NPN + 1 kΩ + pull-down 10 kΩ\nDiodo y condensador en paralelo con el motor")
    text("network", 650, 1240, "Raspberry Pi 4 · CENTRAL\nWi-Fi / Ethernet → WebSocket\nAlimentación propia USB-C. Sin cables GPIO a la manilla.")
    text("note", 110, 1360, "Todas las alimentaciones de módulos: 3,3 V (pin 1) y GND (pin 6). Pines 2 y 4 de 5 V sin conectar.\nPines 36 / GPIO16 y 40 / GPIO21 reservados por audio I2S.\nRepresentación de cableado: los chips personalizados no simulan Raspberry Pi OS ni los sensores.")

    wire("pi:P1_3V3", "rails:3V3", "power", ["h-80", "v-100"])
    wire("pi:P6_GND", "rails:GND", "ground", ["h60", "v-130"])
    for pin in ["oled:VCC", "adc:VDD", "co:VCC", "temp:VIN", "mic:VDD", "buzzer:VCC", "motor:POS"]:
        wire("rails:3V3", pin, "power")
    for pin in ["oled:GND", "adc:GND", "adc:ADDR", "co:GND", "temp:GND", "mic:GND", "mic:L/R", "buzzer:GND", "rgb:COM", "q1:E", "rpd:2", "up:2.l", "down:2.l", "enter:2.l"]:
        wire("rails:GND", pin, "ground")
    # Bus paralelo: tres direcciones I2C sobre los mismos dos GPIO.
    for pin in ["oled:SDA", "adc:SDA", "temp:SDA"]:
        wire("pi:P3_GPIO2_SDA", pin, "sda", ["h-100", "v-140"])
    for pin in ["oled:SCL", "adc:SCL", "temp:SCL"]:
        wire("pi:P5_GPIO3_SCL", pin, "scl", ["h-120", "v-130"])
    wire("co:A", "adc:A0", "analog", ["v100", "*", "h80"])
    for pi_pin, pin in [("P11_GPIO17", "up:1.l"), ("P13_GPIO27", "down:1.l"), ("P15_GPIO22", "enter:1.l")]:
        wire(f"pi:{pi_pin}", pin, "buttons", ["h-80"])
    for pi_pin, pin in [("P12_GPIO18_SCK", "mic:SCK"), ("P35_GPIO19_WS", "mic:WS"), ("P38_GPIO20_SD", "mic:SD")]:
        wire(f"pi:{pi_pin}", pin, "i2s", ["h100"])
    wire("pi:P18_GPIO24", "buzzer:IO", "alerts", ["h120"])
    wire("pi:P16_GPIO23", "rb:1", "alerts", ["h80"])
    wire("rb:2", "q1:B", "alerts")
    wire("q1:B", "rpd:1", "alerts")
    wire("motor:NEG", "q1:C", "alerts")
    wire("motor:POS", "d1:K", "power")
    wire("motor:NEG", "d1:A", "alerts")
    wire("motor:POS", "c1:1", "power")
    wire("motor:NEG", "c1:2", "alerts")
    for pi_pin, resistor, channel in [("P29_GPIO5", "rr", "R"), ("P31_GPIO6", "rg", "G"), ("P33_GPIO13", "rblue", "B")]:
        wire(f"pi:{pi_pin}", f"{resistor}:1", "alerts", ["h-80"])
        wire(f"{resistor}:2", f"rgb:{channel}", "alerts")

    write_json("diagram.json", {"version": 1, "author": "Franco Parra", "editor": "wokwi", "parts": parts, "connections": wires, "dependencies": {}})
    config = ["# Diagrama de cableado: no hay firmware para simular Raspberry Pi OS.", "[wokwi]", "version = 1", ""]
    for name, (label, pins) in CHIPS.items():
        write_json(f"{name}.chip.json", {"name": label, "author": "Franco Parra", "pins": pins})
        (ROOT / f"{name}.chip.c").write_text(
            "// Representación de cableado únicamente. No implementa un modelo eléctrico.\n"
            "void chip_init(void) {}\n"
        )
        config.extend(["[[chip]]", f'name = "{name}"', f'binary = "{name}.chip.wasm"', ""])
    (ROOT / "wokwi.toml").write_text("\n".join(config))


# La vista de montaje usa componentes ilustrados y las conexiones de diagram.json.
if __name__ == "__main__":
    from ilustrar import render
    generate_project()
    render()
