"""Resumen del DRC agrupado por tipo (las advertencias de serigrafía solo se cuentan)."""
import collections
import os
import sys

from mcp_server_kicad import pcb

path = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "manilla-portadora.kicad_pcb")
r = pcb.run_drc(pcb_path=path, output_dir=os.path.abspath("output"))
print("violations", r.violation_count, "unconnected", r.unconnected_count)
for (kind, severity), n in collections.Counter((v["type"], v["severity"]) for v in r.violations).most_common():
    print(f"{n:4d} {kind} ({severity})")
for v in r.violations:
    if not v["type"].startswith("silk"):
        print("-", v["type"], v["description"][:110], "|", "; ".join(i["description"] for i in v["items"])[:170])
if len(sys.argv) > 2:
    for item in r.unconnected_items[: int(sys.argv[2])]:
        print("unconnected:", "; ".join(i["description"] for i in item["items"])[:170])
