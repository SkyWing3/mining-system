"""Configuración JSON; pines numerados en BCM."""
import json
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "settings.example.json"
# I2C (OLED, ADS1115, MLX90614) e I2S del INMP441, incluido el GPIO 16 del overlay googlevoicehat-soundcard.
RESERVED_PINS = (2, 3, 16, 18, 19, 20, 21)


def load_config(path=DEFAULT_CONFIG):
    config = json.loads(Path(path).read_text())
    display, buttons = config["display"], config["buttons"]
    address = display["address"]
    display["address"] = int(address, 0) if isinstance(address, str) else address
    pins = [buttons[key] for key in ("up", "down", "enter")]
    if any(type(pin) is not int or pin not in range(2, 28) or pin in RESERVED_PINS for pin in pins) or len(set(pins)) != 3:
        raise ValueError("Usa tres GPIO BCM distintos entre 4 y 27; GPIO 2/3 (I2C) y 16, 18-21 (I2S) están reservados.")
    if not 0 < buttons["bounce_seconds"] <= 1:
        raise ValueError("bounce_seconds debe estar entre 0 y 1 segundo.")
    if type(display["port"]) is not int or display["port"] < 0:
        raise ValueError("Puerto I2C inválido.")
    if not 0x08 <= display["address"] <= 0x77 or display["rotate"] not in (0, 2):
        raise ValueError("Dirección I2C inválida o rotación distinta de 0/2 (128x64).")
    connection = config.get("connection")
    if connection:
        url = urlparse(connection["url"])
        if url.scheme not in ("ws", "wss") or not url.hostname or url.username or url.password:
            raise ValueError("connection.url debe ser una dirección ws:// o wss:// sin credenciales.")
        key = connection.get("api_key", "")
        if key and (len(key) != 64 or any(char not in "0123456789abcdefABCDEF" for char in key)):
            raise ValueError("api_key debe ser la credencial de 64 caracteres de la central.")
        if not 5 <= connection["heartbeat_seconds"] <= 30:
            raise ValueError("heartbeat_seconds debe estar entre 5 y 30.")
        connection["outbox_path"] = str((Path(path).resolve().parent / connection["outbox_path"]).resolve())
    return config
