"""Agrega vías de costura a GND junto a los pads con alivio térmico incompleto.

Prueba posiciones alrededor del pad en una copia de la placa y solo aplica la
vía si el DRC no aparece ningún error nuevo.
"""
import math
import os
import re
import shutil
import sys

from mcp_server_kicad import pcb

P = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "manilla-portadora.kicad_pcb")
OUT = os.path.join(os.path.dirname(P), "output")
TRY = os.path.join(OUT, "stitch-try.kicad_pcb")


def errors(path):
    drc = pcb.run_drc(pcb_path=path, output_dir=OUT)
    return [v for v in drc.violations if v["severity"] == "error"], drc.unconnected_count


def gnd_number(path):
    return next(n.number for n in pcb.list_pcb_nets(pcb_path=path) if n.name == "/GND")


def pad_position(path, ref, number):
    text = pcb.get_footprint_pads(ref, pcb_path=path)
    for n, x, y in re.findall(r"Pad (\S+): \S+ \S+ @ board \(([\d.]+), ([\d.]+)\)", text):
        if n == number:
            return float(x), float(y)
    raise SystemExit(f"Pad {ref}:{number} no encontrado")


base_errors, _ = errors(P)
targets = []
for v in base_errors:
    if v["type"] == "starved_thermal":
        for item in v["items"]:
            m = re.search(r"Pad (?:PTH )?(\S+) \[/GND\] de (\S+)", item["description"])
            if m:
                targets.append((m.group(2), m.group(1)))
print("pads a reforzar:", targets)
for ref, number in targets:
    px, py = pad_position(P, ref, number)
    placed = False
    for radius in (1.9, 2.4, 3.0):
        for step in range(12):
            angle = 2 * math.pi * step / 12
            x, y = round(px + radius * math.cos(angle), 3), round(py + radius * math.sin(angle), 3)
            shutil.copyfile(P, TRY)
            pcb.add_via(x, y, size=0.8, drill=0.4, net=gnd_number(TRY), pcb_path=TRY)
            pcb.fill_zones(pcb_path=TRY)
            errs, unconnected = errors(TRY)
            still = [e for e in errs if e["type"] == "starved_thermal" and ref in str(e["items"])]
            if len(errs) < len(base_errors) and not still and unconnected == 0 and \
                    all(e["type"] == "starved_thermal" for e in errs):
                shutil.copyfile(TRY, P)
                base_errors = errs
                print(f"vía de costura junto a {ref}:{number} en ({x - 100:.2f}, {y - 100:.2f})")
                placed = True
                break
        if placed:
            break
    if not placed:
        print(f"sin posición libre junto a {ref}:{number}")
os.remove(TRY)
errs, unconnected = errors(P)
print("errores restantes:", [e["type"] for e in errs] or "ninguno", "| sin conectar:", unconnected)
