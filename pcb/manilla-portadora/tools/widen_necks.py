"""Ensancha los tramos que Freerouting angostó al llegar a los pads (neck-down).

Cada tramo más angosto que el mínimo pasa a 0.25 mm; si el DRC encuentra un
choque de margen en ese tramo, se deja en 0.2 mm (el mínimo de la placa).
"""
import os
import sys

from mcp_server_kicad import pcb

MIN_WIDTH = 0.2


def segments(P):
    return [t for t in pcb.list_pcb_traces(pcb_path=P) if t.type == "segment"]


def set_width(P, t, nets, width):
    pad = 0.001
    pcb.set_trace_width(width, net_name=nets[t.net], layer=t.layer, x_min=min(t.start_x, t.end_x) - pad,
                        y_min=min(t.start_y, t.end_y) - pad, x_max=max(t.start_x, t.end_x) + pad,
                        y_max=max(t.start_y, t.end_y) + pad, pcb_path=P)



def near(t, x, y, margin=0.5):
    return (min(t.start_x, t.end_x) - margin <= x <= max(t.start_x, t.end_x) + margin and
            min(t.start_y, t.end_y) - margin <= y <= max(t.start_y, t.end_y) + margin)


def widen(P: str) -> None:
    OUT = os.path.dirname(P)
    nets = {n.number: n.name for n in pcb.list_pcb_nets(pcb_path=P)}
    necks = [t for t in segments(P) if t.width < MIN_WIDTH - 1e-6]
    print("tramos angostos:", len(necks))
    for t in necks:
        set_width(P, t, nets, 0.25)
    drc = pcb.run_drc(pcb_path=P, output_dir=OUT)
    clashes = [v for v in drc.violations if v["type"] == "clearance"]
    fixed = 0
    for t in necks:
        for v in clashes:
            if any(i.get("pos") and near(t, i["pos"]["x"], i["pos"]["y"]) and nets[t.net] in i["description"]
                   for i in v["items"]):
                set_width(P, t, nets, MIN_WIDTH)
                fixed += 1
                break
    print("tramos dejados en 0.2 mm:", fixed)


if __name__ == "__main__":
    widen(os.path.abspath(sys.argv[1]))
