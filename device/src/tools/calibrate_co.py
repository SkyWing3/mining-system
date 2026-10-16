"""Calibración del SEN0564 por dos puntos.

1. Con el sensor precalentado y en aire limpio se mide la línea base.
2. Opcionalmente, con un gas de referencia de concentración conocida, se
   calcula la pendiente ppm/V.

Ejecutar en la manilla, desde device:
    .venv/bin/python -m src.tools.calibrate_co --config config/settings.json --reference-ppm 100
Copiar el bloque impreso en sensors.co.calibration de settings.json.
"""
from __future__ import annotations

import argparse
import json
import time

from ..config import load_config
from ..sensors.ads1115 import Ads1115


def average_volts(adc: Ads1115, channel: int, seconds: float, interval: float = 0.5) -> float:
    values = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        values.append(adc.read_volts(channel, 4))
        time.sleep(interval)
    return sum(values) / len(values)


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrar el sensor de CO SEN0564")
    parser.add_argument("--config", required=True)
    parser.add_argument("--seconds", type=float, default=60, help="Duración de cada medición")
    parser.add_argument("--reference-ppm", type=float, help="Concentración del gas de referencia, en ppm")
    args = parser.parse_args()
    settings = load_config(args.config).sensors

    from smbus2 import SMBus
    with SMBus(settings.i2c_port) as bus:
        adc = Ads1115(bus, settings.ads1115_address)
        print(f"Midiendo aire limpio durante {args.seconds:.0f} s. El sensor debe llevar al menos "
              f"{settings.co.warmup_seconds} s encendido.")
        baseline = average_volts(adc, settings.co.channel, args.seconds)
        print(f"Línea base: {baseline:.4f} V")
        if args.reference_ppm is None:
            print("Sin gas de referencia no se puede calcular ppm_per_volt; la manilla seguirá informando voltios.")
            return
        input(f"Expón el sensor a {args.reference_ppm:g} ppm de CO y pulsa Enter cuando la lectura se estabilice...")
        reference = average_volts(adc, settings.co.channel, args.seconds)
        if reference <= baseline:
            parser.exit(1, f"La tensión con gas ({reference:.4f} V) no supera la línea base; repite la medición.\n")
        calibration = {"baseline_volts": round(baseline, 4), "ppm_per_volt": round(args.reference_ppm / (reference - baseline), 2)}
        print("Agrega en settings.json, dentro de sensors.co:")
        print(json.dumps({"calibration": calibration}, indent=2))


if __name__ == "__main__":
    main()
