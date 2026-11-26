"""Ubica las huellas de la placa portadora, dibuja el contorno y define las reglas.

Igual que build_schematic.py, usa las funciones del servidor MCP de KiCad. Se
ejecuta después de update_pcb_from_schematic:

    ~/.local/share/uv/tools/mcp-server-kicad/bin/python -I tools/build_pcb.py

Coordenadas en mm, con el origen en la esquina superior izquierda de la placa
(se desplaza a OX, OY en la hoja de KiCad). La DevKitC-1 se apoya en la
columna izquierda con la antena arriba y sus USB abajo.
"""
from __future__ import annotations

import sys
from pathlib import Path

from mcp_server_kicad import pcb
from mcp_server_kicad.models import PointSpec

ROOT = Path(__file__).resolve().parents[1]
PCB = str(ROOT / "manilla-portadora.kicad_pcb")
SCH = str(ROOT / "manilla-portadora.kicad_sch")
PRO = str(ROOT / "manilla-portadora.kicad_pro")
OX, OY = 100.0, 100.0
W, H = 54.0, 66.0
SPACING = 0.6

# DevKitC-1 v1.1 (plano DXF de Espressif): 25.46 x 62.87 mm, filas a 22.86 mm,
# pin 1 a 1.57 mm del borde de la antena.
DEVKIT_X = 0.5
J1_X, J3_X, PIN1_Y = DEVKIT_X + 1.30, DEVKIT_X + 24.16, 1.57

# reference: (x, y, rotation, layer)
FIXED = {
    "J1": (J1_X, PIN1_Y, 0, "F.Cu"),
    "J3": (J3_X, PIN1_Y, 0, "F.Cu"),
    "J2": (13.2, 63.4, 0, "F.Cu"),          # USB-C de carga, boca en el borde inferior
    "H1": (3.0, 63.5, 0, "F.Cu"),
    "H2": (30.0, 3.0, 0, "F.Cu"),
    # Interfaz a la vista (zona derecha)
    "D6": (35.0, 5.0, 0, "F.Cu"),
    "R18": (43.0, 2.2, 180, "F.Cu"),  # pad del LED hacia D6
    "R19": (43.0, 4.7, 180, "F.Cu"),  # pad del LED hacia D6
    "R20": (43.0, 7.2, 180, "F.Cu"),  # pad del LED hacia D6
    "SW2": (28.5, 11.0, 0, "F.Cu"),
    "SW3": (28.5, 19.5, 0, "F.Cu"),
    "SW4": (28.5, 28.0, 0, "F.Cu"),
    "Q4": (41.5, 12.5, 0, "F.Cu"),
    "R21": (41.5, 16.5, 0, "F.Cu"),
    "R22": (41.5, 19.0, 0, "F.Cu"),
    "D7": (41.5, 22.0, 0, "F.Cu"),
    "Q5": (41.5, 26.5, 0, "F.Cu"),
    "R23": (41.5, 30.0, 0, "F.Cu"),
    "R24": (41.5, 32.5, 0, "F.Cu"),
    "D8": (43.5, 38.0, 90, "F.Cu"),
    "C12": (43.5, 43.5, 0, "F.Cu"),
    "BZ1": (30.0, 42.0, 0, "F.Cu"),
    "D1": (42.5, 47.0, 0, "F.Cu"),
    "D2": (42.5, 49.5, 0, "F.Cu"),
    "C7": (29.5, 54.5, 0, "F.Cu"),
    "C8": (37.5, 54.5, 0, "F.Cu"),
    "R15": (30.0, 61.0, 0, "F.Cu"),
    "R16": (30.0, 63.5, 0, "F.Cu"),
    "C11": (35.0, 61.0, 0, "F.Cu"),
    "C13": (35.0, 63.5, 0, "F.Cu"),
    # Conectores de modulos en el borde derecho (pin 1 abajo)
    "J8": (49.5, 16.6, 90, "F.Cu"),
    "J5": (49.5, 33.0, 90, "F.Cu"),
    "J6": (49.5, 49.4, 90, "F.Cu"),
    "J7": (49.5, 63.0, 90, "F.Cu"),
    # Bateria, interruptor y motor por debajo (la bateria va bajo la placa)
    "J4": (7.5, 12.5, 0, "B.Cu"),
    "J10": (16.5, 12.5, 0, "B.Cu"),
    "J9": (7.5, 20.5, 0, "B.Cu"),
    # --- Debajo de la DevKitC, cara superior (componentes bajos, < 8 mm) ---
    # Seleccion de fuente junto al conector del interruptor
    "D3": (15.5, 17.0, 0, "F.Cu"),
    "R10": (14.5, 21.0, 0, "F.Cu"),
    "Q3": (19.8, 21.0, 0, "F.Cu"),
    # Elevador MT3608 junto al pin 5V (J1-21)
    # Girado: SW mira al pad SW de L1 y al anodo de D4; IN/EN al lado de L1.1 y C4.
    "U3": (8.0, 30.0, 180, "F.Cu"),
    "C4": (5.0, 25.8, 90, "F.Cu"),
    "L1": (8.0, 35.5, 0, "F.Cu"),
    "D4": (12.5, 37.0, 90, "F.Cu"),
    "C5": (16.0, 37.0, 90, "F.Cu"),
    "C6": (19.5, 37.0, 90, "F.Cu"),
    "R11": (12.6, 26.4, 0, "F.Cu"),
    "R12": (12.6, 24.0, 0, "F.Cu"),
    "D5": (6.0, 49.0, 90, "F.Cu"),
    # Cargador TP4056 junto al USB-C
    "U1": (15.5, 50.0, 0, "F.Cu"),
    "R3": (9.5, 46.0, 90, "F.Cu"),
    "C1": (11.0, 54.5, 0, "F.Cu"),
    "C2": (20.5, 55.0, 90, "F.Cu"),
    "R1": (9.0, 58.0, 0, "F.Cu"),
    "R2": (17.5, 57.8, 0, "F.Cu"),
    # --- Debajo de la DevKitC, cara inferior ---
    # Proteccion de la bateria junto a J4
    # DW01A girado: OD, CS y OC miran a los MOSFET; R9 queda entre Q1 y Q2.
    "U2": (8.0, 40.0, 180, "B.Cu"),
    "Q1": (14.0, 37.5, 0, "B.Cu"),
    "Q2": (14.0, 43.0, 0, "B.Cu"),
    "R9": (13.0, 40.25, 0, "B.Cu"),
    "R8": (5.0, 44.5, 90, "B.Cu"),
    "C3": (8.0, 44.5, 90, "B.Cu"),
    # Medicion de bateria (GPIO1) y de USB (GPIO2), cerca de J3
    "R13": (19.5, 19.5, 0, "B.Cu"),
    "R14": (19.5, 22.0, 0, "B.Cu"),
    "C9": (19.5, 24.5, 0, "B.Cu"),
    "R6": (20.0, 27.5, 0, "B.Cu"),
    "R7": (20.0, 30.0, 0, "B.Cu"),
    # Resistencias de los LED de carga, bajo D1/D2
    "R4": (42.5, 47.0, 0, "B.Cu"),
    "R5": (42.5, 49.5, 0, "B.Cu"),
}

# Optional packed regions: (x0, y0, x1, y1, layer, references in placement order).
REGIONS: list = []

ANTENNA_KEEPOUT = [(4.0, 0.0), (22.4, 0.0), (22.4, 8.5), (4.0, 8.5)]
# The autorouter ignores the board-edge clearance: strips along the edges keep tracks 0.6 mm away.
EDGE = 0.6
EDGE_KEEPOUTS = [
    [(0, 0), (W, 0), (W, EDGE), (0, EDGE)],
    [(0, H - EDGE), (W, H - EDGE), (W, H), (0, H)],
    [(0, 0), (EDGE, 0), (EDGE, H), (0, H)],
    [(W - EDGE, 0), (W, 0), (W, H), (W - EDGE, H)],
]

POWER_NETS = ["/GND", "/VBUS", "/SYS", "/SYS_ON", "/BOOST_SW", "/BOOST", "/+5V", "/BAT+", "/BAT-", "/PROT_D",
              "/+3V3", "/MOT_N"]


def check(result) -> None:
    text = str(result)
    print(text[:240])
    if "error" in text.lower() and "0 error" not in text.lower():
        sys.exit(f"Detenido: {text}")


def board(x: float, y: float) -> tuple[float, float]:
    return round(OX + x, 3), round(OY + y, 3)


def extents(ref: str, rotation: float, layer: str) -> tuple[float, float, float, float]:
    """Courtyard extents relative to the origin, for the given orientation and side."""
    pcb.move_footprint(ref, OX - 50, OY - 50, rotation=rotation, layer=layer, pcb_path=PCB)
    info = pcb.get_footprint_bounds(ref, pcb_path=PCB)
    c = info.courtyard
    return c["min_x"] - (OX - 50), c["min_y"] - (OY - 50), c["max_x"] - (OX - 50), c["max_y"] - (OY - 50)


def pack(x0: float, y0: float, x1: float, y1: float, layer: str, refs: list[str]) -> None:
    """Shelf packing, left to right and top to bottom, with SPACING between courtyards."""
    cursor_x, cursor_y, shelf = x0, y0, 0.0
    for ref in refs:
        ex0, ey0, ex1, ey1 = extents(ref, 0, layer)
        width, height = ex1 - ex0, ey1 - ey0
        if cursor_x + width > x1:
            cursor_x, cursor_y, shelf = x0, cursor_y + shelf + SPACING, 0.0
        if cursor_y + height > y1:
            sys.exit(f"No cabe {ref} en la región {layer} ({x0},{y0})-({x1},{y1})")
        x, y = cursor_x - ex0, cursor_y - ey0
        check(pcb.move_footprint(ref, *board(x, y), rotation=0, layer=layer, pcb_path=PCB))
        cursor_x += width + SPACING
        shelf = max(shelf, height)


def main() -> None:
    # The board is rebuilt from the schematic every time, so this script can be rerun.
    Path(PCB).unlink(missing_ok=True)
    check(pcb.update_pcb_from_schematic(schematic_path=SCH, pcb_path=PCB, project_path=PRO))
    for (x1, y1), (x2, y2) in [((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))]:
        check(pcb.add_pcb_line(*board(x1, y1), *board(x2, y2), layer="Edge.Cuts", width=0.1, pcb_path=PCB))
    for ref, (x, y, rotation, layer) in FIXED.items():
        check(pcb.move_footprint(ref, *board(x, y), rotation=rotation, layer=layer, pcb_path=PCB))
    for region in REGIONS:
        pack(*region)
    # TP4056 exposed pad: 0.4 mm vias carry heat to the bottom and let it be soldered from there.
    check(pcb.add_thermal_vias("U1", pad_number="9", rows=2, cols=2, spacing=1.2, via_size=0.8, via_drill=0.4,
                               pcb_path=PCB))
    check(pcb.add_keepout_zone([PointSpec(x=board(x, y)[0], y=board(x, y)[1]) for x, y in ANTENNA_KEEPOUT],
                               layers=["F.Cu", "B.Cu"], no_tracks=True, no_vias=True, no_pads=True,
                               no_copper_pour=True, no_footprints=True, pcb_path=PCB))
    for strip in EDGE_KEEPOUTS:
        check(pcb.add_keepout_zone([PointSpec(x=board(x, y)[0], y=board(x, y)[1]) for x, y in strip],
                                   layers=["F.Cu", "B.Cu"], no_tracks=True, no_vias=True, no_pads=False,
                                   no_copper_pour=False, no_footprints=False, pcb_path=PCB))
    nets ={item.name for item in pcb.list_pcb_nets(pcb_path=PCB)}
    # KiCad's Default class is offered to the router too: same 0.8/0.4 mm vias as the rest.
    check(pcb.set_net_class("Default", [], track_width=0.25, clearance=0.25, via_size=0.8, via_drill=0.4, pcb_path=PCB))
    check(pcb.set_net_class("Potencia", [n for n in POWER_NETS if n in nets], track_width=0.6, clearance=0.25,
                            via_size=0.8, via_drill=0.4, pcb_path=PCB))
    check(pcb.set_net_class("Senal", sorted(n for n in nets if n not in POWER_NETS and n), track_width=0.25,
                            clearance=0.25, via_size=0.8, via_drill=0.4, pcb_path=PCB))
    print("Placa lista:", PCB)


if __name__ == "__main__":
    main()
