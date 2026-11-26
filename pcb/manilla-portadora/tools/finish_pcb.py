"""Paso final: toma la placa ruteada por Freerouting, la limpia y agrega los planos de tierra.

    ~/.local/share/uv/tools/mcp-server-kicad/bin/python -I tools/finish_pcb.py [placa_ruteada]

Por defecto lee output/routing/manilla-portadora_routed.kicad_pcb y escribe el
resultado en manilla-portadora.kicad_pcb (la placa sin rutear queda como
output/manilla-portadora-sin-rutear.kicad_pcb).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from mcp_server_kicad import pcb
from mcp_server_kicad.models import PointSpec

sys.path.insert(0, str(Path(__file__).resolve().parent))
from widen_necks import widen  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PCB = ROOT / "manilla-portadora.kicad_pcb"
ROUTED = ROOT / "output" / "routing" / "manilla-portadora_routed.kicad_pcb"
UNROUTED = ROOT / "output" / "manilla-portadora-sin-rutear.kicad_pcb"
OX, OY, W, H = 100.0, 100.0, 54.0, 66.0

# Silkscreen labels: (text, x, y, layer, rotation), board coordinates.
LABELS = [
    # Under the DevKitC antenna: no copper there, readable before the DevKitC is plugged in.
    ("MANILLA MINERA v1", 13.2, 3.2, "F.SilkS", 0),
    ("ESP32-S3 DevKitC-1", 13.2, 5.6, "F.SilkS", 0),
    # Module connectors: beside each one, between it and the driver column.
    ("MIC", 45.8, 10.0, "F.SilkS", 90),
    ("OLED", 45.8, 29.0, "F.SilkS", 90),
    ("MLX", 45.8, 45.5, "F.SilkS", 90),
    ("CO", 45.8, 56.0, "F.SilkS", 90),
    # Connectors mounted underneath: labelled on top, between their pads, for assembly.
    ("BAT+ -", 8.75, 10.3, "F.SilkS", 0),
    ("SW", 17.75, 10.3, "F.SilkS", 0),
    ("MOT+ -", 8.75, 18.4, "F.SilkS", 0),
]


def check(result) -> None:
    text = str(result)
    print(text[:240])
    if "error" in text.lower() and "0 error" not in text.lower():
        sys.exit(f"Detenido: {text}")


def main() -> None:
    routed = Path(sys.argv[1]) if len(sys.argv) > 1 else ROUTED
    if not routed.exists():
        sys.exit(f"No existe {routed}: ejecuta primero el autoruteo.")
    shutil.copyfile(PCB, UNROUTED)
    shutil.copyfile(routed, PCB)
    path = str(PCB)
    check(pcb.remove_dangling_tracks(pcb_path=path))
    widen(path)
    outline = [PointSpec(x=OX + x, y=OY + y) for x, y in [(0, 0), (W, 0), (W, H), (0, H)]]
    for layer in ("F.Cu", "B.Cu"):
        check(pcb.add_copper_zone("/GND", layer, outline, clearance=0.3, min_thickness=0.25, thermal_relief=True,
                                  thermal_gap=0.3, thermal_bridge_width=0.4, priority=0, pcb_path=path))
    for text, x, y, layer, rotation in LABELS:
        check(pcb.add_pcb_text(text, OX + x, OY + y, layer=layer, rotation=rotation, pcb_path=path))
    check(pcb.fill_zones(pcb_path=path))
    # Stitching vias where the GND pour reaches a pad with too few thermal spokes.
    import runpy
    sys.argv = [str(ROOT / "tools" / "stitch_vias.py"), path]
    runpy.run_path(sys.argv[0], run_name="__main__")
    print("Placa terminada:", path)


if __name__ == "__main__":
    main()
