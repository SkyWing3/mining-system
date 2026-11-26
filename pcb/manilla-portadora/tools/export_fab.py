"""Genera el paquete de fabricación en fabricacion/ a partir de la placa terminada.

    ~/.local/share/uv/tools/mcp-server-kicad/bin/python -I tools/export_fab.py
"""
import os
import shutil
import zipfile
from pathlib import Path

from mcp_server_kicad import pcb, schematic

ROOT = Path(__file__).resolve().parents[1]
PCB = str(ROOT / "manilla-portadora.kicad_pcb")
SCH = str(ROOT / "manilla-portadora.kicad_sch")
FAB = ROOT / "fabricacion"
GERBERS = FAB / "gerbers"
DOCS = FAB / "documentos"
TMP = ROOT / "output" / "fab"


def main() -> None:
    for folder in (GERBERS, DOCS, TMP):
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
    pcb.export_gerbers(pcb_path=PCB, output_dir=str(GERBERS), include_drill=True,
                       layers=["F.Cu", "B.Cu", "F.Mask", "B.Mask", "F.SilkS", "B.SilkS", "F.Paste", "B.Paste",
                               "Edge.Cuts"])
    with zipfile.ZipFile(FAB / "manilla-portadora-gerbers.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(GERBERS.iterdir()):
            archive.write(file, f"gerbers/{file.name}")
    schematic.export_bom(schematic_path=SCH, output_dir=str(DOCS))
    shutil.move(schematic.export_schematic(format="pdf", schematic_path=SCH, output_dir=str(TMP)).path,
                DOCS / "esquematico.pdf")
    for name, layers in (("montaje-cara-superior", ["F.Fab", "F.SilkS", "Edge.Cuts"]),
                         ("montaje-cara-inferior", ["B.Fab", "B.SilkS", "Edge.Cuts"])):
        out = TMP / name
        out.mkdir()
        shutil.move(pcb.export_pcb(format="pdf", pcb_path=PCB, output_dir=str(out), layers=layers).path,
                    DOCS / f"{name}.pdf")
    shutil.move(pcb.export_3d(format="step", pcb_path=PCB, output_dir=str(TMP)).path, DOCS / "manilla-portadora-3d.step")
    for side, name in (("top", "vista-superior"), ("bottom", "vista-inferior")):
        result = pcb.export_3d(format="render", pcb_path=PCB, output_dir=str(TMP), width=1100, height=1300, side=side,
                               quality="high")
        shutil.move(result.path, DOCS / f"{name}.png")
    for file in sorted(DOCS.iterdir()):
        print(f"{file.name:40s} {file.stat().st_size:>9d} bytes")
    print("Gerbers:", len(list(GERBERS.iterdir())), "archivos")


if __name__ == "__main__":
    main()
