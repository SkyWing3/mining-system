#!/usr/bin/env python3
"""Envía una configuración JSON a la manilla por la consola serie.

Solo se envían las claves presentes en el archivo: la manilla las combina con
su configuración actual, la valida, la guarda en la flash y se reinicia.

Usar el Python de PlatformIO, que ya incluye pyserial:

    ~/.platformio/penv/bin/python tools/configure.py --port /dev/cu.usbserial-0001 config/settings.json

Con `pio device list` se ven los puertos disponibles.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

try:
    import serial
except ImportError:  # pragma: no cover - depends on the environment
    sys.exit("Falta pyserial: ejecuta este script con ~/.platformio/penv/bin/python")

READY = "Consola de la manilla lista"
SAVED = "Configuración guardada"


def main() -> int:
    parser = argparse.ArgumentParser(description="Configurar la manilla ESP32 por la consola serie")
    parser.add_argument("--port", required=True, help="Puerto serie de la placa (conector UART/COM)")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("file", help="JSON con las claves a cambiar, por ejemplo config/settings.json")
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        print("El archivo debe contener un objeto JSON.", file=sys.stderr)
        return 1
    line = "config set " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"

    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, args.baud, 0.2
    # Keep DTR/RTS released so opening the port does not reset the board.
    port.dtr = False
    port.rts = False
    port.open()
    with port:
        # If the board did reset anyway, wait for the console to come up.
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if READY in port.readline().decode("utf-8", "replace"):
                break
        port.reset_input_buffer()
        port.write(line.encode("utf-8"))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            text = port.readline().decode("utf-8", "replace").rstrip()
            if text.startswith("Error:"):
                print(text, file=sys.stderr)
                return 1
            if SAVED in text:
                print(text)
                return 0
    print("La manilla no respondió; revisa el puerto y que el firmware esté corriendo.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
