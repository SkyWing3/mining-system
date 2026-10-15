"""Clasificación de lecturas en normal, precaución y peligro.

Cada métrica cambia de nivel solo después de `confirm_samples` muestras
consecutivas, y para bajar necesita alejarse del umbral (histéresis). Así una
lectura aislada no dispara ni apaga una alarma.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config import AlertsConfig, Threshold
from ..sensors.readings import SensorSnapshot

NORMAL = "normal"
CAUTION = "caution"
DANGER = "danger"
ORDER = {NORMAL: 0, CAUTION: 1, DANGER: 2}
LABELS = {NORMAL: "Normal", CAUTION: "Precaucion", DANGER: "PELIGRO"}


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    unit: str
    hysteresis: float
    # Alarm group sent to the central: CO or heat.
    group: str


METRICS = (
    Metric("co", "CO", "ppm", 5.0, "co"),
    Metric("ambient", "Ambiente", "°C", 1.0, "heat"),
    Metric("object", "Objeto", "°C", 2.0, "heat"),
)


@dataclass(frozen=True)
class Condition:
    metric: Metric
    level: str
    value: float

    @property
    def text(self) -> str:
        decimals = 0 if self.metric.unit == "ppm" else 1
        return f"{self.metric.label} {self.value:.{decimals}f} {self.metric.unit}"


@dataclass(frozen=True)
class Assessment:
    level: str = NORMAL
    conditions: tuple[Condition, ...] = ()

    def group_level(self, group: str) -> str:
        levels = [condition.level for condition in self.conditions if condition.metric.group == group]
        return max(levels, key=ORDER.__getitem__, default=NORMAL)

    def detail(self, group: str) -> str:
        """Short text for the automatic alarm, e.g. 'CO 245 ppm'."""
        return ", ".join(condition.text for condition in self.conditions if condition.metric.group == group and condition.level == DANGER)


@dataclass
class _MetricState:
    level: str = NORMAL
    pending: str | None = None
    count: int = 0
    value: float | None = None


class ThresholdEvaluator:
    def __init__(self, config: AlertsConfig):
        self.config = config
        self._states = {metric.key: _MetricState() for metric in METRICS}

    def update(self, snapshot: SensorSnapshot) -> Assessment:
        values = {"co": snapshot.co_ppm, "ambient": snapshot.ambient_c, "object": snapshot.object_c}
        conditions = []
        for metric in METRICS:
            value = values[metric.key]
            # Without a value there is no evidence to change the level.
            if value is not None:
                self._step(metric, value)
            state = self._states[metric.key]
            if state.level != NORMAL and state.value is not None:
                conditions.append(Condition(metric, state.level, state.value))
        level = max((condition.level for condition in conditions), key=ORDER.__getitem__, default=NORMAL)
        return Assessment(level, tuple(conditions))

    def _threshold(self, metric: Metric) -> Threshold:
        return {"co": self.config.co_ppm, "ambient": self.config.ambient_c, "object": self.config.object_c}[metric.key]

    def _step(self, metric: Metric, value: float) -> None:
        state = self._states[metric.key]
        state.value = value
        target = classify(value, self._threshold(metric), state.level, metric.hysteresis)
        if target == state.level:
            state.pending, state.count = None, 0
            return
        if target == state.pending:
            state.count += 1
        else:
            state.pending, state.count = target, 1
        if state.count >= self.config.confirm_samples:
            state.level, state.pending, state.count = target, None, 0


def classify(value: float, threshold: Threshold, current: str, hysteresis: float) -> str:
    if value >= threshold.danger or (current == DANGER and value > threshold.danger - hysteresis):
        return DANGER
    if value >= threshold.caution or (current in (CAUTION, DANGER) and value > threshold.caution - hysteresis):
        return CAUTION
    return NORMAL
