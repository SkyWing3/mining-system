"""Genera el esquemático de la placa portadora de la manilla (ESP32-S3 DevKitC-1).

Usa las mismas funciones del servidor MCP de KiCad (mcp-server-kicad), así que
el archivo .kicad_sch nunca se edita a mano. Se ejecuta con el Python de esa
herramienta:

    ~/.local/share/uv/tools/mcp-server-kicad/bin/python -I tools/build_schematic.py

Cada ejecución borra el esquemático y lo vuelve a crear desde estas tablas.
"""
from __future__ import annotations

import sys
from pathlib import Path

from mcp_server_kicad import project, schematic
from mcp_server_kicad.models import PinRefSpec

ROOT = Path(__file__).resolve().parents[1]
NAME = "manilla-portadora"
SCH = str(ROOT / f"{NAME}.kicad_sch")
PRO = str(ROOT / f"{NAME}.kicad_pro")

# --- footprints -----------------------------------------------------------------
R0805 = "Resistor_SMD:R_0805_2012Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
C1206 = "Capacitor_SMD:C_1206_3216Metric"
CP63 = "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm"
LED0805 = "LED_SMD:LED_0805_2012Metric"
SMA = "Diode_SMD:D_SMA"
SOD123 = "Diode_SMD:D_SOD-123"
SOT23 = "Package_TO_SOT_SMD:SOT-23"
SOT236 = "Package_TO_SOT_SMD:SOT-23-6"
# Without the library thermal vias (0.2 mm drill): build_pcb.py adds 0.4 mm ones.
ESOP8 = "Package_SO:SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.41x3.3mm"
SOCKET22 = "Connector_PinSocket_2.54mm:PinSocket_1x22_P2.54mm_Vertical"
USBC = "Connector_USB:USB_C_Receptacle_GCT_USB4125-xx-x_6P_TopMnt_Horizontal"
IND = "Inductor_SMD:L_Bourns-SRN4018"
BUZZER = "Buzzer_Beeper:Buzzer_12x9.5RM7.6"
RGB = "LED_THT:LED_D5.0mm-4_RGB_Staggered_Pins"
BUTTON = "Button_Switch_THT:SW_PUSH_6mm"
HOLE = "MountingHole:MountingHole_2.2mm_M2"


def xh(pins: int) -> str:
    return f"Connector_JST:JST_XH_B{pins}B-XH-A_1x0{pins}_P2.50mm_Vertical"


# --- components: reference, lib_id, value, x, y, rotation, footprint ----------------
# Rows of the A3 sheet (mm). Each part sits in its own cell so label stubs never touch.
ROW = [38.1, 78.74, 119.38, 160.02, 200.66, 241.3, 276.86]
X = [30.48 + 25.4 * i for i in range(12)]

PARTS = [
    # Entrada USB-C (solo carga) y cargador TP4056
    ("J2", "Connector:USB_C_Receptacle_PowerOnly_6P", "USB-C carga", X[0], ROW[0], 0, USBC),
    ("R1", "Device:R", "5.1k", X[1], ROW[0], 0, R0805),
    ("R2", "Device:R", "5.1k", X[2], ROW[0], 0, R0805),
    ("C1", "Device:C", "10uF", X[3], ROW[0], 0, C0805),
    ("U1", "Battery_Management:TP4056-42-ESOP8", "TP4056", X[4] + 5.08, ROW[0], 0, ESOP8),
    ("R3", "Device:R", "2.2k", X[6], ROW[0], 0, R0805),
    ("C2", "Device:C", "10uF", X[7], ROW[0], 0, C0805),
    ("R4", "Device:R", "1k", X[0], ROW[1], 0, R0805),
    ("D1", "Device:LED", "Rojo carga", X[1], ROW[1], 0, LED0805),
    ("R5", "Device:R", "1k", X[2], ROW[1], 0, R0805),
    ("D2", "Device:LED", "Verde lleno", X[3], ROW[1], 0, LED0805),
    ("R6", "Device:R", "15k", X[4], ROW[1], 0, R0805),
    ("R7", "Device:R", "22k", X[5], ROW[1], 0, R0805),
    # Bateria y proteccion (DW01A + 2x AO3400A en drenador comun)
    ("J4", "Connector_Generic:Conn_01x02", "Bateria LiPo", X[8], ROW[0], 0, xh(2)),
    ("R8", "Device:R", "100", X[9], ROW[0], 0, R0805),
    ("C3", "Device:C", "100nF", X[10], ROW[0], 0, C0805),
    ("U2", "Battery_Management:DW01A", "DW01A", X[8], ROW[1], 0, SOT236),
    ("R9", "Device:R", "1k", X[9], ROW[1], 0, R0805),
    ("Q1", "Transistor_FET:Q_NMOS_GSD", "AO3400A", X[10], ROW[1], 0, SOT23),
    ("Q2", "Transistor_FET:Q_NMOS_GSD", "AO3400A", X[11], ROW[1], 0, SOT23),
    ("R13", "Device:R", "100k", X[8], ROW[2], 0, R0805),
    ("R14", "Device:R", "100k", X[9], ROW[2], 0, R0805),
    ("C9", "Device:C", "100nF", X[10], ROW[2], 0, C0805),
    # Seleccion de fuente (USB o bateria), interruptor externo y elevador MT3608
    ("D3", "Device:D_Schottky", "SS14", X[0], ROW[2], 0, SMA),
    ("Q3", "Transistor_FET:Q_PMOS_GSD", "AO3401A", X[1], ROW[2], 0, SOT23),
    ("R10", "Device:R", "100k", X[2], ROW[2], 0, R0805),
    ("J10", "Connector_Generic:Conn_01x02", "Interruptor", X[3], ROW[2], 0, xh(2)),
    ("C4", "Device:C", "22uF", X[4], ROW[2], 0, C1206),
    ("L1", "Device:L", "22uH", X[5], ROW[2], 0, IND),
    ("U3", "Regulator_Switching:MT3608", "MT3608", X[6] + 5.08, ROW[2], 0, SOT236),
    ("D4", "Device:D_Schottky", "SS34", X[0], ROW[3], 0, SMA),
    ("R11", "Device:R", "75k", X[1], ROW[3], 0, R0805),
    ("R12", "Device:R", "10k", X[2], ROW[3], 0, R0805),
    ("C5", "Device:C", "22uF", X[3], ROW[3], 0, C1206),
    ("C6", "Device:C", "22uF", X[4], ROW[3], 0, C1206),
    ("D5", "Device:D_Schottky", "SS34", X[5], ROW[3], 0, SMA),
    ("C7", "Device:C_Polarized", "220uF 10V", X[6], ROW[3], 0, CP63),
    ("C8", "Device:C_Polarized", "220uF 6.3V", X[7], ROW[3], 0, CP63),
    ("C13", "Device:C", "10uF", X[8], ROW[3], 0, C0805),
    # DevKitC-1: dos tiras hembra separadas 22.86 mm (J1 izquierda, J3 derecha)
    ("J1", "Connector:Conn_01x22_Socket", "DevKitC J1", 345.44, 114.3, 0, SOCKET22),
    ("J3", "Connector:Conn_01x22_Socket", "DevKitC J3", 393.7, 114.3, 0, SOCKET22),
    # Conectores a los modulos
    ("J5", "Connector_Generic:Conn_01x04", "OLED", X[0], ROW[5], 0, xh(4)),
    ("J6", "Connector_Generic:Conn_01x04", "MLX90614", X[1] + 7.62, ROW[5], 0, xh(4)),
    ("J7", "Connector_Generic:Conn_01x03", "SEN0564", X[3], ROW[5], 0, xh(3)),
    ("C11", "Device:C", "100nF", X[4], ROW[5], 0, C0805),
    ("J8", "Connector_Generic:Conn_01x06", "INMP441", X[5] + 5.08, ROW[5], 0, xh(6)),
    ("R15", "Device:R", "4.7k", X[7], ROW[5], 0, R0805),
    ("R16", "Device:R", "4.7k", X[8], ROW[5], 0, R0805),
    # Interfaz: LED RGB, pulsadores, buzzer y motor
    ("R18", "Device:R", "120", X[0], ROW[4], 0, R0805),
    ("R19", "Device:R", "47", X[1], ROW[4], 0, R0805),
    ("R20", "Device:R", "47", X[2], ROW[4], 0, R0805),
    ("D6", "Device:LED_RKGB", "RGB catodo comun", X[3] + 2.54, ROW[4], 0, RGB),
    ("SW2", "Switch:SW_Push", "SUBIR", X[5], ROW[4], 0, BUTTON),
    ("SW3", "Switch:SW_Push", "BAJAR", X[6] + 5.08, ROW[4], 0, BUTTON),
    ("SW4", "Switch:SW_Push", "ENTER", X[8], ROW[4], 0, BUTTON),
    ("BZ1", "Device:Buzzer", "Buzzer activo 5V", X[9], ROW[5], 0, BUZZER),
    ("D7", "Device:D", "1N4148W", X[10], ROW[5], 0, SOD123),
    ("Q4", "Transistor_BJT:Q_NPN_BEC", "MMBT3904", X[11], ROW[5], 0, SOT23),
    ("R21", "Device:R", "1k", X[0], ROW[6], 0, R0805),
    ("R22", "Device:R", "10k", X[1], ROW[6], 0, R0805),
    ("Q5", "Transistor_FET:Q_NMOS_GSD", "AO3400A", X[2], ROW[6], 0, SOT23),
    ("R23", "Device:R", "100", X[3], ROW[6], 0, R0805),
    ("R24", "Device:R", "100k", X[4], ROW[6], 0, R0805),
    ("J9", "Connector_Generic:Conn_01x02", "Motor", X[5], ROW[6], 0, xh(2)),
    ("D8", "Device:D_Schottky", "SS14", X[6], ROW[6], 0, SMA),
    ("C12", "Device:C", "100nF", X[7], ROW[6], 0, C0805),
    ("H1", "Mechanical:MountingHole", "M2", X[9], ROW[6], 0, HOLE),
    ("H2", "Mechanical:MountingHole", "M2", X[10], ROW[6], 0, HOLE),
]

# --- nets: name -> [(reference, pin), ...] ---------------------------------------
NETS = {
    "GND": [("J2", "A12"), ("J2", "B12"), ("J2", "SH"), ("R1", "2"), ("R2", "2"), ("C1", "2"), ("U1", "1"),
            ("U1", "3"), ("U1", "9"), ("R3", "2"), ("C2", "2"), ("R7", "2"), ("R9", "2"), ("Q2", "2"),
            ("R10", "2"), ("C4", "2"), ("U3", "2"), ("R12", "2"), ("C5", "2"), ("C6", "2"), ("C7", "2"),
            ("C8", "2"), ("C13", "2"), ("R14", "2"), ("C9", "2"), ("J1", "22"), ("J3", "1"), ("J3", "21"),
            ("J3", "22"), ("J5", "1"), ("J6", "2"), ("J7", "2"), ("J8", "2"), ("J8", "6"), ("C11", "2"),
            ("D6", "2"), ("SW2", "2"), ("SW3", "2"), ("SW4", "2"), ("Q4", "2"), ("R22", "2"), ("Q5", "2"),
            ("R24", "2")],
    "+3V3": [("J1", "1"), ("J1", "2"), ("R15", "1"), ("R16", "1"), ("J5", "2"), ("J6", "1"), ("J7", "1"),
             ("J8", "1"), ("C13", "1"), ("C8", "1"), ("J9", "1"), ("D8", "1"), ("C12", "1")],
    "+5V": [("J1", "21"), ("D5", "1"), ("C7", "1"), ("BZ1", "1"), ("D7", "1")],
    "VBUS": [("J2", "A9"), ("J2", "B9"), ("C1", "1"), ("U1", "4"), ("U1", "8"), ("R4", "1"), ("R5", "1"),
             ("R6", "1"), ("D3", "2"), ("Q3", "1"), ("R10", "1")],
    "CC1": [("J2", "A5"), ("R1", "1")],
    "CC2": [("J2", "B5"), ("R2", "1")],
    "PROG": [("U1", "2"), ("R3", "1")],
    "CHRG_N": [("U1", "7"), ("D1", "1")],
    "CHRG_LED": [("R4", "2"), ("D1", "2")],
    "STDBY_N": [("U1", "6"), ("D2", "1")],
    "STDBY_LED": [("R5", "2"), ("D2", "2")],
    "BAT+": [("U1", "5"), ("C2", "1"), ("J4", "1"), ("R8", "1"), ("Q3", "3"), ("R13", "1")],
    "BAT-": [("J4", "2"), ("U2", "6"), ("C3", "2"), ("Q1", "2")],
    "DW_VCC": [("R8", "2"), ("U2", "5"), ("C3", "1")],
    "DW_OD": [("U2", "1"), ("Q1", "1")],
    "DW_OC": [("U2", "3"), ("Q2", "1")],
    "DW_CS": [("U2", "2"), ("R9", "1")],
    "PROT_D": [("Q1", "3"), ("Q2", "3")],
    "SYS": [("D3", "1"), ("Q3", "2"), ("J10", "1")],
    "SYS_ON": [("J10", "2"), ("U3", "5"), ("U3", "4"), ("L1", "1"), ("C4", "1")],
    "BOOST_SW": [("L1", "2"), ("U3", "1"), ("D4", "2")],
    "BOOST": [("D4", "1"), ("R11", "1"), ("C5", "1"), ("C6", "1"), ("D5", "2")],
    "BOOST_FB": [("R11", "2"), ("R12", "1"), ("U3", "3")],
    "VBAT_SENSE": [("R13", "2"), ("R14", "1"), ("C9", "1"), ("J3", "4")],
    "VBUS_SENSE": [("R6", "2"), ("R7", "1"), ("J3", "5")],
    "CO_OUT": [("J7", "3"), ("C11", "1"), ("J1", "4")],
    "I2C_SDA": [("J1", "12"), ("R15", "2"), ("J5", "4"), ("J6", "4")],
    "I2C_SCL": [("J1", "15"), ("R16", "2"), ("J5", "3"), ("J6", "3")],
    # I2S on the right column (GPIO 42/41/40), facing the microphone connector.
    "MIC_SCK": [("J3", "7"), ("J8", "4")],
    "MIC_WS": [("J3", "6"), ("J8", "5")],
    "MIC_SD": [("J3", "8"), ("J8", "3")],
    "BTN_UP": [("J1", "5"), ("SW2", "1")],
    "BTN_DOWN": [("J1", "6"), ("SW3", "1")],
    "BTN_ENTER": [("J1", "7"), ("SW4", "1")],
    "LED_R": [("J1", "8"), ("R18", "1")],
    "LED_G": [("J1", "9"), ("R19", "1")],
    "LED_B": [("J1", "10"), ("R20", "1")],
    "LED_RA": [("R18", "2"), ("D6", "1")],
    "LED_GA": [("R19", "2"), ("D6", "3")],
    "LED_BA": [("R20", "2"), ("D6", "4")],
    "BUZZER": [("J1", "11"), ("R21", "1")],
    "BZ_B": [("R21", "2"), ("R22", "1"), ("Q4", "1")],
    "BZ_N": [("Q4", "3"), ("BZ1", "2"), ("D7", "2")],
    "MOTOR": [("J1", "16"), ("R23", "1")],
    "MOT_G": [("R23", "2"), ("R24", "1"), ("Q5", "1")],
    "MOT_N": [("Q5", "3"), ("J9", "2"), ("D8", "2"), ("C12", "2")],
}

# DevKitC pins not used by the wristband, plus the ICs' unused pins.
NO_CONNECT = [("J1", "3"), ("J1", "13"), ("J1", "14"), ("J1", "17"), ("J1", "18"), ("J1", "19"), ("J1", "20"),
              ("J3", "2"), ("J3", "3")] + [("J3", str(pin)) for pin in range(9, 21)] + [("U2", "4"), ("U3", "6")]

# Nets whose power inputs have no power output driving them (connectors and passives).
POWER_FLAGS = ["GND", "VBUS", "BAT-", "DW_VCC", "SYS_ON", "+3V3", "+5V"]

TEXTS = [
    ("Entrada USB-C (solo carga) y cargador TP4056: 545 mA con R3 = 2.2k", 22.86, 22.86),
    ("Bateria LiPo 1S y proteccion DW01A (Q1 descarga, Q2 carga)", 200.66, 22.86),
    ("Ruta de energia: USB por D3 o bateria por Q3; interruptor externo en J10; MT3608 a 5.1 V -> D5 -> pin 5V", 22.86, 104.14),
    ("DevKitC-1 N16R8: J1 izq., J3 der., filas a 22.86 mm", 335.28, 71.12),
    ("Interfaz: LED RGB (catodo comun), pulsadores, buzzer activo (activo en alto)", 22.86, 185.42),
    ("Modulos: OLED y MLX90614 por I2C, SEN0564 en ADC1 (GPIO4), INMP441 por I2S (GPIO 41/42/40)", 22.86, 226.06),
    ("Motor vibrador 3V con AO3400A; Q4/Q5 con resistencias a GND para que arranquen apagados", 22.86, 262.89),
]


def check(result: str) -> None:
    text = str(result)
    print(text[:300])
    if "error" in text.lower() or "refus" in text.lower():
        sys.exit(f"Detenido: {text}")


def main() -> None:
    sch = Path(SCH)
    if sch.exists():
        sch.unlink()
    if Path(PRO).exists():
        check(project.create_schematic(SCH))
    else:
        check(project.create_project(str(ROOT), NAME))
    check(schematic.set_page_size("A3", schematic_path=SCH))
    for ref, lib_id, value, x, y, rot, footprint in PARTS:
        check(schematic.place_component(lib_id, ref, value, x, y, rot, schematic_path=SCH, project_path=PRO))
        check(schematic.set_component_property(ref, "Footprint", footprint, schematic_path=SCH))
    for index, net in enumerate(POWER_FLAGS):
        ref = f"#FLG{index + 1:02d}"
        check(schematic.add_power_symbol("power:PWR_FLAG", ref, 330.2 + 15.24 * (index % 5), 190.5 + 25.4 * (index // 5),
                                         schematic_path=SCH, project_path=PRO))
        NETS[net].append((ref, "1"))
    for net, pins in NETS.items():
        check(schematic.wire_pins_to_net([PinRefSpec(reference=r, pin=p) for r, p in pins], net, schematic_path=SCH))
    for ref, pin in NO_CONNECT:
        check(schematic.no_connect_pin(ref, pin, schematic_path=SCH))
    for text, x, y in TEXTS:
        # KiCad centers text on its anchor: shift it so the text starts at x.
        check(schematic.add_text(text, round(x + 0.635 * len(text), 2), y, schematic_path=SCH))
    print("Esquemático generado:", SCH)


if __name__ == "__main__":
    main()
