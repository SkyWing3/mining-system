"""Vista de montaje con dibujos de componentes, generada desde diagram.json.

Los SVG de pulsadores, LED y resistencias proceden de @wokwi/elements 1.9.2
(MIT). Los módulos restantes se dibujan aquí con sus terminales del proyecto.
"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT = 2400, 1770
PALETTE = {
    "#d97706": "#ffa844", "#475569": "#141414", "#2563eb": "#4386ff",
    "#0891b2": "#37d7de", "#16a34a": "#48df85", "#9333ea": "#c688ff",
    "#0d9488": "#42cbb8", "#e11d48": "#ff668f",
}


def render():
    from generar import HEADER

    diagram = json.loads((ROOT / "diagram.json").read_text())
    artwork = json.loads((ROOT / "assets/wokwi-elements.json").read_text())
    body, labels, cables = [], [], []
    ports = {}

    def add(markup):
        body.append(markup)

    def text(x, y, value, size=16, fill="#f2f2f2", anchor="start", weight="400", layer=None):
        target = body if layer is None else layer
        target.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{html.escape(value)}</text>')

    def line(points, color, width=2, layer=None):
        target = body if layer is None else layer
        target.append(f'<polyline points="{" ".join(f"{x},{y}" for x, y in points)}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')

    def rect(x, y, w, h, fill, rx=0, stroke=None, sw=1):
        add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="{sw}"' if stroke else '') + '/>')

    def circle(x, y, r, fill, stroke=None, sw=1):
        add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="{sw}"' if stroke else '') + '/>')

    def hole(x, y, r=9):
        circle(x, y, r + 3, "#c0a550")
        circle(x, y, r, "#303030", "#958951", 1.5)

    def pad(ident, name, x, y, label=None, label_y=-16, label_size=13):
        ports[f"{ident}:{name}"] = (x, y)
        circle(x, y, 8, "#c7b887", "#e0cd94", 1)
        circle(x, y, 4, "#2b2b2b")
        if label is not False:
            text(x, y + label_y, label or name, label_size, "#f5f2e4", "middle")

    def pcb(x, y, w, h, color="#065f3d", radius=10):
        rect(x + 3, y + 5, w, h, "#151918", radius)
        rect(x, y, w, h, color, radius, "#2e8761", 1.5)
        # Pistas y vías discretas, como una placa vista desde arriba.
        for i in range(8):
            xx = x + 30 + i * (w - 60) / 8
            line([(xx, y + 35), (xx, y + h / 2), (xx + 16, y + h / 2 + 16), (xx + 16, y + h - 23)], "#87a997", 1)
        for i in range(5):
            circle(x + 30 + i * 21, y + h - 31, 2, "#819c86")

    def ic(x, y, w, h, label="", pins=6):
        for i in range(pins):
            yy = y + 5 + i * (h - 10) / max(1, pins - 1)
            rect(x - 9, yy - 2, 13, 4, "#c7c6bd", 1)
            rect(x + w - 4, yy - 2, 13, 4, "#c7c6bd", 1)
        rect(x, y, w, h, "#1f2223", 3, "#484b4d")
        rect(x + 4, y + 4, w - 8, 2, "#404344", 1)
        circle(x + 7, y + 8, 2, "#727575")
        if label:
            text(x + w / 2, y + h / 2 + 4, label, min(12, w / 7), "#8d9290", "middle")

    def smd(x, y, vertical=False, beige=False):
        w, h = (7, 18) if vertical else (18, 7)
        rect(x, y, w, h, "#c8cbc7", 1)
        rect(x + (1 if vertical else 4), y + (4 if vertical else 1), w - (2 if vertical else 8), h - (8 if vertical else 2), "#d5bd86" if beige else "#323537")

    def caption(x, y, title, subtitle=""):
        text(x, y, title, 21, "#fafafa", "middle", "600", labels)
        if subtitle:
            text(x, y + 25, subtitle, 14, "#b7bdc5", "middle", layer=labels)

    def native(ident, asset, x, y, scale):
        info = artwork[asset]
        markup = info["svg"]
        # Evitar colisiones de gradientes al reutilizar el mismo componente.
        for old in sorted(set(re.findall(r'\bid="([^"]+)"', markup)), key=len, reverse=True):
            new = f"native-{ident}-{old}"
            markup = markup.replace(f'id="{old}"', f'id="{new}"').replace(f'url(#{old})', f'url(#{new})').replace(f'href="#{old}"', f'href="#{new}"')
        markup = re.sub(r'\swidth="[^"]+"', f' width="{info["width"] * scale}"', markup, count=1)
        markup = re.sub(r'\sheight="[^"]+"', f' height="{info["height"] * scale}"', markup, count=1)
        markup = markup.replace('<svg ', f'<svg x="{x}" y="{y}" ', 1)
        add(f'<g id="part-{ident}" data-artwork="wokwi-elements">{markup}</g>')
        for pin in info["pins"]:
            ports[f'{ident}:{pin["name"]}'] = (x + pin["x"] * scale, y + pin["y"] * scale)

    # Distribución física de alimentación. Cada agujero pertenece a una de las
    # dos líneas: naranja = 3,3 V, negra = GND, alimentadas por pin 1 y pin 6.
    rect(75, 488, 2200, 100, "#cfceca", 8, "#f0efeb")
    rect(88, 496, 2174, 83, "#dcdad5", 4)
    for xx in range(110, 2260, 25):
        for yy in (520, 560):
            rect(xx - 4, yy - 4, 8, 8, "#5c6060", 2)
    line([(100, 520), (2250, 520)], "#ed922c", 2)
    line([(100, 560), (2250, 560)], "#333333", 2)
    text(116, 510, "+ 3,3 V", 13, "#8f4c00", weight="700")
    text(116, 551, "− GND", 13, "#222222", weight="700")
    ports["rails:3V3"] = (2250, 520)
    ports["rails:GND"] = (2220, 560)
    text(1175, 630, "Líneas comunes de alimentación · 3,3 V desde pin 1 / GND desde pin 6", 16, "#c9cdd2", "middle", layer=labels)

    # OLED SSD1306 de cuatro terminales, como el módulo del proyecto.
    pcb(180, 220, 280, 200, "#073e78")
    for x, y in [(195, 236), (445, 236), (195, 402), (445, 402)]:
        hole(x, y, 6)
    rect(200, 243, 240, 127, "#080c10", 4, "#858b92", 2)
    rect(208, 251, 224, 111, "#041620", 2)
    for i, label in enumerate(["MINING SYSTEM", "> Estado", "  Gases", "  Temperatura", "  Mensajes"]):
        text(222, 271 + i * 18, label, 13, "#75dcff")
    rect(220, 382, 200, 26, "#181a1c", 2)
    for name, x in zip(["GND", "VCC", "SCL", "SDA"], [230, 290, 350, 410]):
        pad("oled", name, x, 402, label_y=-18)
    caption(320, 162, "OLED SSD1306", "128 × 64 · I²C 0x3C")

    # ADS1115: diez terminales, cuatro canales analógicos y ADC de 16 bits.
    pcb(650, 220, 320, 200, "#07506c")
    hole(669, 239, 7); hole(950, 239, 7)
    ic(784, 268, 75, 61, "ADS1115", 5)
    for i in range(5):
        smd(686 + i * 46, 256, beige=i % 2 == 0)
        smd(686 + i * 46, 350)
    text(810, 242, "16 BIT I²C ADC", 13, "white", "middle")
    for i, name in enumerate(["VDD", "GND", "SCL", "SDA", "ADDR", "ALRT", "A0", "A1", "A2", "A3"]):
        pad("adc", name, 666 + i * 32, 401, label_y=-16, label_size=10)
    caption(810, 162, "ADS1115", "Conversor analógico · I²C 0x48")

    # Sensor de monóxido de carbono MEMS, cápsula dorada perforada.
    pcb(1160, 242, 220, 177, "#202e32")
    for xx in (1178, 1362):
        hole(xx, 261, 6)
    rect(1210, 263, 118, 85, "#b6b9ac", 5, "#ebebe0", 2)
    rect(1216, 269, 106, 73, "#caa71d", 4)
    for i in range(4):
        for j in range(3):
            circle(1233 + 23 * i, 282 + 23 * j, 4, "#3e3a16")
    smd(1182, 312, True); smd(1346, 317, True, True)
    for name, x in zip(["A", "VCC", "GND"], [1202, 1270, 1338]):
        pad("co", name, x, 401, label_y=-15)
    caption(1270, 162, "SEN0564 · CO", "Salida A → ADS1115 A0")

    # Termómetro GY-906 / MLX90614, cápsula TO-39 con ventana IR.
    pcb(1740, 220, 250, 200, "#08617d")
    hole(1760, 239, 7); hole(1970, 239, 7)
    circle(1865, 304, 65, "#7f868b", "#d4d7d6", 3)
    circle(1865, 301, 57, "url(#metal)", "#f0f0e8", 2)
    circle(1865, 297, 37, "#636367", "#b8bdba", 6)
    circle(1865, 295, 28, "#22232c", "#393b43", 2)
    add('<path d="M1816 277 A55 55 0 0 1 1903 263" fill="none" stroke="#f7f7ea" stroke-width="5" opacity=".65"/>')
    for name, x in zip(["VIN", "GND", "SCL", "SDA"], [1772, 1834, 1896, 1958]):
        pad("temp", name, x, 401, label_y=-14)
    caption(1865, 162, "MLX90614", "Temperatura infrarroja · I²C 0x5A")

    # Raspberry Pi Zero 2 W: dibujo de placa, no sustitución por una Pico.
    px, py = 1000, 700
    pcb(px, py, 360, 710, "#006a42", 20)
    for xx in (px + 22, px + 338):
        for yy in (py + 22, py + 688):
            hole(xx, yy, 13)
    rect(1010, 741, 68, 608, "#123b2e", 4, "#e4e7ce", 1)
    for row, pair in enumerate(HEADER):
        for index, name in enumerate(pair):
            xx, yy = 1027 + index * 30, 760 + row * 30
            if row == 0 and index == 0:
                rect(xx - 10, yy - 10, 20, 20, "#e3d97e", 2)
            pad("pi", name, xx, yy, label=False)
    text(1009, 737, "1", 12, "#fafad1")
    # CPU y radio, con componentes de montaje superficial.
    ic(1125, 958, 151, 151, "RP3A0", 12)
    text(1200, 1054, "Raspberry Pi", 12, "#7f8581", "middle")
    text(1200, 1073, "ZERO 2 W", 12, "#7f8581", "middle")
    rect(1135, 811, 135, 95, "url(#metal)", 4, "#a0aaa7", 2)
    text(1202, 863, "WIRELESS", 11, "#6c7272", "middle")
    for xx in range(1110, 1320, 34):
        smd(xx, 929, beige=True)
        smd(xx, 1135, True)
        smd(xx, 1182)
    ic(1289, 958, 30, 40, pins=4)
    ic(1100, 1185, 45, 60, pins=5)
    # Dos micro-USB en el borde derecho: alimentación y USB OTG.
    for yy, label in [(752, "PWR IN"), (864, "USB")]:
        rect(1310, yy, 61, 67, "#a2a7a8", 4, "#dedfdf", 2)
        rect(1356, yy + 9, 17, 49, "#d3d6d4", 2)
        rect(1360, yy + 17, 13, 33, "#23272a", 1)
        for n in range(4):
            rect(1305, yy + 10 + n * 13, 8, 5, "#d7d8ce")
        text(1299, yy + 40, label, 10, "#faf7d9", "end")
    # Mini HDMI y lector microSD.
    rect(1295, 1180, 77, 115, "url(#metal)", 4, "#cdd1cc", 2)
    rect(1353, 1195, 20, 85, "#1b2328", 2)
    text(1288, 1224, "HDMI", 10, "#faf7d9", "end")
    rect(1120, 1280, 147, 98, "url(#metal)", 5, "#acb6b0", 2)
    for yy in (1290, 1357):
        rect(1130, yy, 127, 9, "#69716e", 1)
    for i in range(6):
        rect(1132 + i * 20, 1269, 8, 15, "#d2b35b")
    text(1193, 1336, "microSD", 16, "#626865", "middle")
    text(1204, 740, "Raspberry Pi Zero 2 W", 13, "#f6f3d9", "middle", "600")
    text(1206, 1168, "GPIO 40 · 3,3 V", 13, "#e3ebd3", "middle")
    caption(1180, 1464, "Raspberry Pi Zero 2 W", "Pines físicos 1–40 · GPIO BCM del PDF")

    # Pulsadores y resistencias usan los dibujos originales de Wokwi.
    for ident, yy, title, subtitle in [("up", 780, "Subir", "GPIO17 · pin 11"), ("down", 970, "Bajar", "GPIO27 · pin 13"), ("enter", 1160, "Enter", "GPIO22 · pin 15")]:
        native(ident, ident, 300, yy, 3.1)
        caption(345, yy - 35, title, subtitle)
    native("rgb", "rgb", 300, 1370, 2)
    caption(340, 1330, "LED RGB", "Cátodo común")
    for ident, asset, yy, value in [("rr", "r220", 1340, "R · 220 Ω"), ("rg", "r100", 1410, "G · 100 Ω"), ("rblue", "r100", 1480, "B · 100 Ω")]:
        native(ident, asset, 535, yy, 2.3)
        # Invertir visualmente la resistencia no cambia sus terminales Wokwi.
        text(602, yy - 10, value, 14, "#d7d9db", "middle", layer=labels)

    # Módulo buzzer con alimentación y señal, en vez de un buzzer de dos patas.
    pcb(1840, 730, 220, 180, "#20282b")
    for x, y in [(1857, 747), (2043, 747)]:
        hole(x, y, 6)
    circle(1950, 800, 66, "#080a0c", "#363b3b", 3)
    circle(1950, 797, 57, "#141617", "#272a2c", 2)
    circle(1950, 796, 11, "#020304", "#333638", 2)
    add('<path d="M1908 760 A55 55 0 0 1 1985 753" fill="none" stroke="#44474a" stroke-width="3"/>')
    ic(1864, 835, 23, 24, pins=3)
    for name, xx in zip(["VCC", "GND", "IO"], [1884, 1950, 2016]):
        pad("buzzer", name, xx, 892, label="I/O" if name == "IO" else name, label_y=-12)
    caption(1950, 676, "Buzzer activo", "I/O → GPIO24 · pin 18")

    # Motor moneda, con dos cables y protección externa.
    circle(1900, 1032, 64, "#818b90", "#dadfe0", 3)
    circle(1900, 1028, 58, "url(#motor-metal)", "#c1c9c9", 2)
    circle(1900, 1025, 50, "#606b70", "#8d969c", 1)
    text(1900, 1033, "3 V", 17, "#c6ccce", "middle")
    line([(1880, 1082), (1878, 1133)], "#e33c38", 6)
    line([(1921, 1082), (1930, 1133)], "#4c7cc8", 6)
    ports["motor:POS"], ports["motor:NEG"] = (1878, 1133), (1930, 1133)
    caption(1900, 966, "Motor vibrador", "GPIO23 · pin 16 → transistor")

    # Diodo de vidrio: banda negra del cátodo hacia 3,3 V.
    line([(1500, 1055), (1730, 1055)], "#b4b6b2", 6)
    rect(1558, 1037, 115, 36, "#a95526", 12, "#d08e5b", 2)
    rect(1569, 1039, 90, 8, "#f0b888", 4)
    rect(1645, 1037, 13, 36, "#262728", 1)
    ports["d1:A"], ports["d1:K"] = (1500, 1055), (1730, 1055)
    text(1510, 1084, "A", 13, "#d4d4d4", layer=labels)
    text(1718, 1084, "K", 13, "#d4d4d4", "end", layer=labels)
    caption(1616, 1001, "1N4148", "K → 3,3 V · A → colector")

    # Condensador cerámico de 100 nF sobre el motor.
    line([(2138, 1061), (2128, 1140)], "#bfc0b8", 5)
    line([(2170, 1061), (2180, 1140)], "#bfc0b8", 5)
    add('<ellipse cx="2155" cy="1043" rx="40" ry="44" fill="url(#ceramic)" stroke="#e2a345" stroke-width="2"/>')
    text(2155, 1051, "104", 20, "#503b22", "middle")
    ports["c1:1"], ports["c1:2"] = (2128, 1140), (2180, 1140)
    caption(2155, 969, "100 nF", "Filtro del motor")

    # NPN TO-92 con tres patillas explícitas B, C y E.
    for name, xx in [("B", 1880), ("C", 1915), ("E", 1950)]:
        line([(xx, 1200), (xx, 1270)], "#a5aaa8", 6)
        ports[f"q1:{name}"] = (xx, 1270)
        text(xx, 1293, name, 14, "#e5e7e9", "middle", layer=labels)
    add('<path d="M1861 1210 L1861 1172 Q1915 1128 1969 1172 L1969 1210 Z" fill="#16191b" stroke="#4c5153" stroke-width="2"/>')
    rect(1861, 1178, 108, 36, "#292e30", 2)
    text(1915, 1201, "2N2222A", 13, "#8f999c", "middle")
    native("rb", "r1k", 1580, 1205, 2.5)
    text(1654, 1193, "1 kΩ · base", 15, "#e1e2e3", "middle", layer=labels)
    native("rpd", "r10k", 1600, 1355, 2.5)
    text(1674, 1340, "10 kΩ · pull-down", 15, "#e1e2e3", "middle", layer=labels)

    # INMP441 circular, con los seis terminales en el orden de la placa real.
    circle(2020, 1440, 107, "#1a343f", "#9a9865", 5)
    circle(2020, 1440, 98, "#1c343d", "#335664", 1)
    for angle in range(6):
        yy = 1375 + angle * 22
        line([(1960, yy), (1995, yy), (2010, yy + 12), (2076, yy + 12)], "#4b6971", 1)
    rect(2011, 1400, 65, 67, "url(#metal)", 6, "#d2c99d", 3)
    circle(2057, 1420, 4, "#494f50")
    text(2044, 1448, "441", 14, "#9b956e", "middle")
    smd(1940, 1415, True, True); smd(1967, 1424, True)
    for name, xx, yy in [("L/R", 1966, 1378), ("WS", 2020, 1378), ("SCK", 2074, 1378), ("GND", 1966, 1502), ("VDD", 2020, 1502), ("SD", 2074, 1502)]:
        pad("mic", name, xx, yy, label_y=-14 if yy == 1378 else 26, label_size=12)
    caption(2020, 1305, "INMP441", "Micrófono I²S · canal izquierdo")

    # Los extremos y las redes se toman del archivo Wokwi, no de otra tabla de
    # conexiones. Cada cable conserva una descripción con sus dos terminales.
    def cable(a, b, color, via):
        if a not in ports or b not in ports:
            raise ValueError(f"Terminal sin dibujo: {a} / {b}")
        points = [ports[a], *via, ports[b]]
        color = PALETTE.get(color, color)
        for channel, channel_color in [("rr:", "#ff6565"), ("rg:", "#60e493"), ("rblue:", "#69a7ff")]:
            if a.startswith(channel) or b.startswith(channel):
                color = channel_color
        title = html.escape(a + " ↔ " + b)
        coords = " ".join(f"{x},{y}" for x, y in points)
        cables.append(f'<g class="connection" data-from="{html.escape(a)}" data-to="{html.escape(b)}"><title>{title}</title><polyline points="{coords}" fill="none" stroke="#535353" stroke-opacity=".6" stroke-width="6.8" stroke-linejoin="round" stroke-linecap="round"/><polyline class="wire" points="{coords}" fill="none" stroke="{color}" stroke-width="4.4" stroke-linejoin="round" stroke-linecap="round"/></g>')

    def pi_exit(node, y_offset=11):
        xx, yy = ports[node]
        return [(xx, yy + y_offset), (975, yy + y_offset)] if node.split(":")[1].split("_")[0][1:].isdigit() and int(node.split(":")[1].split("_")[0][1:]) % 2 == 0 else [(975, yy)]

    for a, b, color, _ in diagram["connections"]:
        x1, y1 = ports[a]; x2, y2 = ports[b]
        via = []
        if b == "rails:3V3":
            via = [(910, y1), (910, 520)]
        elif b == "rails:GND":
            via = pi_exit(a) + [(930, y1 + 11), (930, 560)]
        elif a.startswith("rails:"):
            power = a == "rails:3V3"
            rail_y, trunk = (520, 2250) if power else (560, 2220)
            if y2 < 480:
                # Cada módulo superior baja a la línea común correspondiente.
                via = [(x2, rail_y)]
            elif b.startswith(("up:", "down:", "enter:", "rgb:")):
                via = [(100, rail_y), (100, y2 + 28), (x2 - 35, y2 + 28), (x2 - 35, y2)]
            elif b.startswith("q1:"):
                via = [(trunk, 1590), (x2, 1590)]
            elif b == "rpd:2":
                via = [(trunk, 1555), (x2 + 30, 1555), (x2 + 30, y2)]
            elif b.startswith("mic:"):
                # Alimentación por la parte inferior y selección de canal por
                # el exterior izquierdo de la placa circular.
                if b == "mic:L/R":
                    via = [(trunk, 1580), (1890, 1580), (1890, y2)]
                else:
                    yy = 1610 if power else 1635
                    via = [(trunk, yy), (x2, yy)]
            elif b == "motor:POS":
                via = [(trunk, 1103), (1800, 1103), (1800, y2)]
            else:
                via = [(trunk, y2 + (35 if power else 57)), (x2, y2 + (35 if power else 57))]
        elif a in {"pi:P3_GPIO2_SDA", "pi:P5_GPIO3_SCL"}:
            yy, xx = (450, 875) if "SDA" in a else (472, 850)
            # ADC SCL/SDA y los terminales de los demás módulos comparten bus.
            via = [(xx, y1), (xx, yy), (x2, yy)]
        elif a == "co:A":
            via = [(x1, 435), (x2, 435)]
        elif b in {"up:1.l", "down:1.l", "enter:1.l"}:
            xx = {"up:1.l": 740, "down:1.l": 770, "enter:1.l": 800}[b]
            via = [(xx, y1), (xx, y2), (x2 - 25, y2)]
        elif b.startswith("mic:"):
            xx, yy, target_x = {
                "mic:SCK": (880, 1555, 2130),
                "mic:WS": (900, 1575, 1840),
                "mic:SD": (920, 1595, 2095),
            }[b]
            via = pi_exit(a) + [(xx, ports[a][1] + (11 if int(a.split(':P')[1].split('_')[0]) % 2 == 0 else 0)), (xx, yy), (target_x, yy), (target_x, y2)]
        elif b == "buzzer:IO":
            # Salir entre filas de la cabecera y rodear el borde superior.
            via = pi_exit(a) + [(950, y1 + 11), (950, 665), (2110, 665), (2110, 935), (x2, 935)]
        elif b == "rb:1":
            via = pi_exit(a) + [(960, y1 + 11), (960, 1515), (1460, 1515), (1460, y2)]
        elif a == "rb:2":
            via = [(1800, y1), (1800, y2)]
        elif a == "q1:B" and b == "rpd:1":
            via = [(1800, y1), (1800, 1310), (1560, 1310), (1560, y2)]
        elif a == "motor:NEG":
            yy = 1155
            if b == "q1:C":
                via = [(1995, y1), (1995, yy), (1995, 1250), (x2, 1250)]
            elif b == "d1:A":
                via = [(1995, y1), (1995, yy), (1480, yy), (1480, y2)]
            else:
                via = [(1995, y1), (1995, yy), (2200, yy), (2200, y2)]
        elif a == "motor:POS":
            if b == "d1:K":
                via = [(1800, y1), (1800, y2)]
            else:
                via = [(1800, y1), (1800, 1103), (2095, 1103), (2095, y2)]
        elif b in {"rr:1", "rg:1", "rblue:1"}:
            # Terminal 1 de cada resistencia queda hacia la izquierda. Cada
            # color usa un corredor distinto para conservar redes separadas.
            xx = {"rr:1": 705, "rg:1": 735, "rblue:1": 765}[b]
            yy = {"rr:1": 1317, "rg:1": 1387, "rblue:1": 1457}[b]
            via = [(xx, y1), (xx, yy), (500, yy), (500, y2)]
        elif b.startswith("rgb:"):
            yy = {"rgb:R": 1560, "rgb:G": 1580, "rgb:B": 1600}[b]
            xx = {"rgb:R": 475, "rgb:G": 490, "rgb:B": 505}[b]
            return_x = {"rgb:R": 690, "rgb:G": 815, "rgb:B": 840}[b]
            offset = {"rgb:R": 15, "rgb:G": 35, "rgb:B": 55}[b]
            via = [(return_x, y1), (return_x, yy), (xx, yy), (xx, y2 + offset), (x2, y2 + offset)]
        else:
            raise ValueError(f"Cable sin trazado: {a} / {b}")
        cable(a, b, color, via)

    for xx, yy, color in [(1800, 1103, "#ffa844"), (1995, 1155, "#42cbb8"), (1800, 1270, "#42cbb8")]:
        labels.append(f'<circle cx="{xx}" cy="{yy}" r="5" fill="{color}"/>')

    # Identificación de los GPIO conectados sobre el margen de la cabecera.
    active = {pin for connection in diagram["connections"] for pin in connection[:2] if pin.startswith("pi:")}
    for pin in sorted(active):
        number = int(pin.split(":P")[1].split("_")[0])
        xx, yy = ports[pin]
        name = pin.split("_", 1)[1].replace("_", " ")
        if number == 1:
            name = "3,3 V"
        text(970, yy - (5 if number % 2 else -22), f"{number} · {name}", 12, "#c5cbc8", "end", layer=labels)

    # La Pi 4 sólo es una central de red: no se dibujan cables GPIO hacia ella.
    rect(100, 1680, 2200, 65, "#282a2c", 9, "#45484b")
    lx = 126
    for label, color, space in [("3,3 V", "#ffa844", 150), ("GND", "#141414", 130), ("SDA", "#4386ff", 130), ("SCL", "#37d7de", 130), ("Botones", "#48df85", 170), ("Audio I²S", "#c688ff", 180), ("Alertas", "#42cbb8", 165), ("CO", "#ff668f", 110)]:
        line([(lx, 1700), (lx + 30, 1700)], color, 5)
        text(lx + 40, 1705, label, 14, "#cfd3d6")
        lx += space
    text(2250, 1706, "Pi 4: central por Wi-Fi / Ethernet · sin cables GPIO", 15, "#d9dce0", "end")
    text(125, 1731, "Pines 2 y 4 (5 V) sin conectar. GPIO16 / pin 36 y GPIO21 / pin 40 reservados. B/C/E del transistor: comprobar el encapsulado real.", 13, "#b1b7bb")

    text(90, 75, "MINING SYSTEM", 34, "#fafafa", weight="700", layer=labels)
    text(90, 108, "Diagrama de montaje · Manilla inteligente para mineros", 18, "#b9bdc3", layer=labels)
    text(2295, 76, "Raspberry Pi Zero 2 W", 19, "#e3e6e8", "end", "600", labels)
    text(2295, 106, "51 conexiones · docs/conexiones.pdf", 15, "#b9bdc3", "end", layer=labels)
    text(360, 1652, "RGB: omitir resistencias externas si el módulo ya las integra.", 13, "#b2b7bd", layer=labels)

    defs = '''<defs>
<linearGradient id="metal" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f0f1e9"/><stop offset=".22" stop-color="#acb4b1"/><stop offset=".5" stop-color="#d8ddda"/><stop offset=".8" stop-color="#949c9b"/><stop offset="1" stop-color="#e5e7dc"/></linearGradient>
<radialGradient id="motor-metal"><stop stop-color="#c3cbd0"/><stop offset=".8" stop-color="#818c91"/><stop offset="1" stop-color="#d5dad9"/></radialGradient>
<radialGradient id="ceramic" cx=".35" cy=".25"><stop stop-color="#f4c66e"/><stop offset=".65" stop-color="#d48b2d"/><stop offset="1" stop-color="#a86215"/></radialGradient>
</defs>'''
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">
<title id="title">Mining System — Diagrama de montaje con componentes ilustrados</title>
<desc id="desc">Raspberry Pi Zero 2 W, OLED, ADS1115, SEN0564, MLX90614, INMP441, botones, LED RGB, buzzer y motor con 51 conexiones tomadas del diagrama Wokwi.</desc>
<style>text{{font-family:Arial,Helvetica,sans-serif}}.connection:hover .wire{{stroke-width:8}}.connection{{cursor:help}}</style>
{defs}<rect width="{WIDTH}" height="{HEIGHT}" fill="#303030"/>
<g id="components">{''.join(body)}</g>
<g id="connections">{''.join(cables)}</g>
<g id="labels">{''.join(labels)}</g></svg>'''
    (ROOT / "diagrama.svg").write_text(svg + "\n")
    page = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mining System · Diagrama de montaje</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#303030;color:#eee;font:14px Arial,sans-serif}
header{min-height:64px;padding:12px 22px;background:#242424;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid #474747}h1{font-size:18px;margin:0 auto 0 0}
button,a{border:1px solid #555;border-radius:5px;background:#393939;padding:8px 12px;color:#f5f5f5;text-decoration:none;cursor:pointer}button:hover,a:hover{background:#505050}
#viewport{overflow:auto;height:calc(100vh - 100px)}#diagram{width:100%;min-width:1080px}svg{display:block;width:100%;height:auto}svg svg{width:revert;height:revert}
footer{height:36px;padding:10px 22px;background:#242424;color:#b9bdc3;font-size:12px}
@media print{header,footer{display:none}#viewport{height:auto;overflow:visible}#diagram{width:100%!important;min-width:0}@page{size:A3 landscape;margin:0}}
</style><header><h1>Mining System · Montaje de la manilla</h1><button id="out" aria-label="Alejar">−</button><button id="fit">Ajustar</button><button id="in" aria-label="Acercar">+</button><a href="diagrama.svg" download>SVG</a><a href="diagrama.png" download>PNG</a><a href="diagrama.pdf" download>PDF</a><a href="diagram.json" download>Archivo Wokwi</a></header>
<main id="viewport"><div id="diagram">''' + svg + '''</div></main>
<footer>Pasa el cursor sobre un cable para ver sus terminales. Ilustración de montaje; las conexiones corresponden al PDF del proyecto.</footer>
<script>let zoom=100;const diagram=document.getElementById('diagram');const setZoom=v=>{zoom=Math.max(50,Math.min(300,v));diagram.style.width=zoom+'%'};document.getElementById('in').onclick=()=>setZoom(zoom+20);document.getElementById('out').onclick=()=>setZoom(zoom-20);document.getElementById('fit').onclick=()=>setZoom(100);</script></html>'''
    (ROOT / "diagrama.html").write_text(page)
    print(f"Vista ilustrada: {len(diagram['connections'])} cables, componentes SVG y gráficos originales Wokwi.")


if __name__ == "__main__":
    render()
