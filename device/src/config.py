"""Configuración JSON validada. Los pines usan numeración BCM."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "settings.example.json"
# I2C (OLED, ADS1115, MLX90614) e I2S del INMP441, incluido el GPIO 16 del overlay googlevoicehat-soundcard.
RESERVED_PINS = (2, 3, 16, 18, 19, 20, 21)
VALID_PINS = range(4, 28)
SAMPLE_RATES = (8000, 16000, 22050, 32000, 44100, 48000)


@dataclass(frozen=True)
class DisplayConfig:
    port: int = 1
    address: int = 0x3C
    rotate: int = 0


@dataclass(frozen=True)
class ButtonsConfig:
    up: int = 17
    down: int = 27
    enter: int = 22
    bounce_seconds: float = 0.08

    @property
    def pins(self) -> tuple[int, int, int]:
        return self.up, self.down, self.enter


@dataclass(frozen=True)
class ConnectionConfig:
    url: str
    api_key: str = ""
    heartbeat_seconds: float = 20
    telemetry_seconds: float = 2
    outbox_path: Path = Path("state/outbox")
    voice_outbox_path: Path = Path("state/voice")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def voice_url(self) -> str:
        """HTTP endpoint for voice uploads on the same host as the WebSocket."""
        parsed = urlparse(self.url)
        scheme = "https" if parsed.scheme == "wss" else "http"
        base = parsed.path[: -len("/ws/device")] if parsed.path.endswith("/ws/device") else ""
        return parsed._replace(scheme=scheme, path=f"{base}/api/device/voice", query="", fragment="").geturl()


@dataclass(frozen=True)
class CoCalibration:
    baseline_volts: float
    ppm_per_volt: float

    def ppm(self, volts: float) -> float:
        return max(0.0, (volts - self.baseline_volts) * self.ppm_per_volt)


@dataclass(frozen=True)
class CoConfig:
    enabled: bool = True
    channel: int = 0
    samples: int = 4
    warmup_seconds: int = 180
    calibration: CoCalibration | None = None


@dataclass(frozen=True)
class ThermometerConfig:
    enabled: bool = True
    address: int = 0x5A


@dataclass(frozen=True)
class SensorsConfig:
    i2c_port: int = 1
    sample_seconds: float = 1.0
    ads1115_address: int = 0x48
    co: CoConfig = field(default_factory=CoConfig)
    mlx90614: ThermometerConfig = field(default_factory=ThermometerConfig)


@dataclass(frozen=True)
class Threshold:
    caution: float
    danger: float


@dataclass(frozen=True)
class AlertsConfig:
    enabled: bool = True
    led_red: int = 5
    led_green: int = 6
    led_blue: int = 13
    led_active_high: bool = True
    buzzer_pin: int = 24
    buzzer_active_high: bool = False
    motor_pin: int = 23
    button_feedback: bool = True
    silence_seconds: int = 60
    confirm_samples: int = 3
    co_ppm: Threshold = Threshold(35, 200)
    ambient_c: Threshold = Threshold(32, 38)
    object_c: Threshold = Threshold(60, 90)

    @property
    def pins(self) -> tuple[int, ...]:
        return self.led_red, self.led_green, self.led_blue, self.buzzer_pin, self.motor_pin


@dataclass(frozen=True)
class VoiceConfig:
    enabled: bool = True
    alsa_device: str = "plughw:CARD=sndrpigooglevoi,DEV=0"
    sample_rate: int = 16000
    max_seconds: int = 30
    max_pending: int = 20


@dataclass(frozen=True)
class Settings:
    display: DisplayConfig
    buttons: ButtonsConfig
    connection: ConnectionConfig | None
    sensors: SensorsConfig
    alerts: AlertsConfig
    voice: VoiceConfig


def load_config(path: str | Path = DEFAULT_CONFIG) -> Settings:
    path = Path(path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("La configuración debe ser un objeto JSON.")
    base = path.resolve().parent
    settings = Settings(
        display=_display(raw.get("display", {})),
        buttons=_buttons(raw.get("buttons", {})),
        connection=_connection(raw["connection"], base) if raw.get("connection") else None,
        sensors=_sensors(raw.get("sensors", {})),
        alerts=_alerts(raw.get("alerts", {})),
        voice=_voice(raw.get("voice", {})),
    )
    _validate_pins(settings)
    return settings


def _display(data: dict[str, Any]) -> DisplayConfig:
    config = DisplayConfig(
        port=_integer(data.get("port", 1), "display.port", 0, 9),
        address=_address(data.get("address", 0x3C), "display.address"),
        rotate=data.get("rotate", 0),
    )
    if config.rotate not in (0, 2):
        raise ValueError("Rotación distinta de 0/2 (128x64).")
    return config


def _buttons(data: dict[str, Any]) -> ButtonsConfig:
    bounce = _number(data.get("bounce_seconds", 0.08), "buttons.bounce_seconds")
    if not 0 < bounce <= 1:
        raise ValueError("bounce_seconds debe estar entre 0 y 1 segundo.")
    return ButtonsConfig(up=data.get("up", 17), down=data.get("down", 27), enter=data.get("enter", 22), bounce_seconds=bounce)


def _connection(data: dict[str, Any], base: Path) -> ConnectionConfig:
    url = urlparse(str(data.get("url", "")))
    if url.scheme not in ("ws", "wss") or not url.hostname or url.username or url.password:
        raise ValueError("connection.url debe ser una dirección ws:// o wss:// sin credenciales.")
    key = data.get("api_key", "") or ""
    if key and (len(key) != 64 or any(char not in "0123456789abcdefABCDEF" for char in key)):
        raise ValueError("api_key debe ser la credencial de 64 caracteres de la central.")
    heartbeat = _number(data.get("heartbeat_seconds", 20), "connection.heartbeat_seconds")
    if not 5 <= heartbeat <= 30:
        raise ValueError("heartbeat_seconds debe estar entre 5 y 30.")
    telemetry = _number(data.get("telemetry_seconds", 2), "connection.telemetry_seconds")
    if not 1 <= telemetry <= 30:
        raise ValueError("telemetry_seconds debe estar entre 1 y 30.")
    # Relative queue folders are resolved against the JSON file.
    outbox = (base / data.get("outbox_path", "../state/outbox")).resolve()
    voice = (base / data.get("voice_outbox_path", "../state/voice")).resolve()
    if outbox == voice:
        raise ValueError("outbox_path y voice_outbox_path deben ser carpetas distintas.")
    return ConnectionConfig(url=url.geturl(), api_key=key, heartbeat_seconds=heartbeat, telemetry_seconds=telemetry,
                            outbox_path=outbox, voice_outbox_path=voice)


def _sensors(data: dict[str, Any]) -> SensorsConfig:
    sample = _number(data.get("sample_seconds", 1), "sensors.sample_seconds")
    if not 0.2 <= sample <= 10:
        raise ValueError("sensors.sample_seconds debe estar entre 0,2 y 10.")
    co_data = data.get("co", {})
    calibration = co_data.get("calibration")
    if calibration is not None:
        baseline = _number(calibration.get("baseline_volts"), "co.calibration.baseline_volts")
        slope = _number(calibration.get("ppm_per_volt"), "co.calibration.ppm_per_volt")
        if not 0 <= baseline <= 4.096 or slope <= 0:
            raise ValueError("La calibración de CO requiere baseline_volts entre 0 y 4,096 V y ppm_per_volt positivo.")
        calibration = CoCalibration(baseline, slope)
    co = CoConfig(
        enabled=bool(co_data.get("enabled", True)),
        channel=_integer(co_data.get("channel", 0), "co.channel", 0, 3),
        samples=_integer(co_data.get("samples", 4), "co.samples", 1, 16),
        warmup_seconds=_integer(co_data.get("warmup_seconds", 180), "co.warmup_seconds", 0, 3600),
        calibration=calibration,
    )
    mlx_data = data.get("mlx90614", {})
    mlx = ThermometerConfig(enabled=bool(mlx_data.get("enabled", True)), address=_address(mlx_data.get("address", 0x5A), "mlx90614.address"))
    ads_address = _address(data.get("ads1115", {}).get("address", 0x48), "ads1115.address")
    return SensorsConfig(i2c_port=_integer(data.get("i2c_port", 1), "sensors.i2c_port", 0, 9), sample_seconds=sample,
                         ads1115_address=ads_address, co=co, mlx90614=mlx)


def _alerts(data: dict[str, Any]) -> AlertsConfig:
    led, buzzer, motor = data.get("led", {}), data.get("buzzer", {}), data.get("motor", {})
    thresholds = data.get("thresholds", {})
    defaults = AlertsConfig()
    return AlertsConfig(
        enabled=bool(data.get("enabled", True)),
        led_red=led.get("red", defaults.led_red),
        led_green=led.get("green", defaults.led_green),
        led_blue=led.get("blue", defaults.led_blue),
        led_active_high=bool(led.get("active_high", defaults.led_active_high)),
        buzzer_pin=buzzer.get("pin", defaults.buzzer_pin),
        buzzer_active_high=bool(buzzer.get("active_high", defaults.buzzer_active_high)),
        motor_pin=motor.get("pin", defaults.motor_pin),
        button_feedback=bool(data.get("button_feedback", True)),
        silence_seconds=_integer(data.get("silence_seconds", 60), "alerts.silence_seconds", 5, 600),
        confirm_samples=_integer(data.get("confirm_samples", 3), "alerts.confirm_samples", 1, 30),
        co_ppm=_threshold(thresholds.get("co_ppm"), defaults.co_ppm, "co_ppm"),
        ambient_c=_threshold(thresholds.get("ambient_c"), defaults.ambient_c, "ambient_c"),
        object_c=_threshold(thresholds.get("object_c"), defaults.object_c, "object_c"),
    )


def _voice(data: dict[str, Any]) -> VoiceConfig:
    rate = data.get("sample_rate", 16000)
    if rate not in SAMPLE_RATES:
        raise ValueError(f"voice.sample_rate debe ser uno de {SAMPLE_RATES}.")
    device = str(data.get("alsa_device", VoiceConfig.alsa_device))
    if not device or any(char.isspace() for char in device):
        raise ValueError("voice.alsa_device inválido.")
    return VoiceConfig(
        enabled=bool(data.get("enabled", True)),
        alsa_device=device,
        sample_rate=rate,
        max_seconds=_integer(data.get("max_seconds", 30), "voice.max_seconds", 1, 60),
        max_pending=_integer(data.get("max_pending", 20), "voice.max_pending", 1, 200),
    )


def _threshold(data: dict[str, Any] | None, default: Threshold, name: str) -> Threshold:
    if data is None:
        return default
    caution = _number(data.get("caution"), f"thresholds.{name}.caution")
    danger = _number(data.get("danger"), f"thresholds.{name}.danger")
    if caution >= danger:
        raise ValueError(f"thresholds.{name}: caution debe ser menor que danger.")
    return Threshold(caution, danger)


def _validate_pins(settings: Settings) -> None:
    buttons = settings.buttons.pins
    if any(type(pin) is not int or pin not in VALID_PINS or pin in RESERVED_PINS for pin in buttons) or len(set(buttons)) != 3:
        raise ValueError("Usa tres GPIO BCM distintos entre 4 y 27; GPIO 2/3 (I2C) y 16, 18-21 (I2S) están reservados.")
    if not settings.alerts.enabled:
        return
    outputs = settings.alerts.pins
    if any(type(pin) is not int or pin not in VALID_PINS or pin in RESERVED_PINS for pin in outputs):
        raise ValueError("Las salidas de alerta deben usar GPIO BCM entre 4 y 27, fuera de I2C e I2S.")
    if len(set(outputs)) != len(outputs) or set(outputs) & set(buttons):
        raise ValueError("Cada botón y salida de alerta necesita un GPIO distinto.")


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} debe ser un número.")
    return float(value)


def _integer(value: Any, name: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{name} debe ser un entero entre {low} y {high}.")
    return value


def _address(value: Any, name: str) -> int:
    try:
        address = int(value, 0) if isinstance(value, str) else value
    except ValueError:
        raise ValueError(f"{name}: dirección I2C inválida.") from None
    if type(address) is not int or not 0x08 <= address <= 0x77:
        raise ValueError(f"{name}: dirección I2C inválida.")
    return address
