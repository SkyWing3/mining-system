"""Fotograma monocromo 128x64 compatible con SSD1306 y simulador."""
from __future__ import annotations

import unicodedata

from PIL import Image, ImageDraw, ImageFont

from ..alerts.levels import CAUTION, DANGER, LABELS
from ..communication.catalog import MESSAGES
from ..sensors.readings import (CO_DISABLED, CO_ERROR, CO_OK, CO_UNCALIBRATED, CO_WARMING, THERMOMETER_DISABLED,
                                THERMOMETER_ERROR)
from .menu import MESSAGES_PAGE, PAGES, VOICE_PAGE, Menu

WIDTH, HEIGHT = 128, 64
LINES = (15, 27, 39)
FOOTER_LINE, FOOTER_TEXT = 54, 53


def oled_text(text: str) -> str:
    """The built-in font has no accented glyphs: names from the central are shown without accents."""
    return "".join(char if char.isascii() or char == "°" else unicodedata.normalize("NFKD", char).encode("ascii", "ignore").decode()
                   for char in text)


class OledDraw(ImageDraw.ImageDraw):
    def text(self, xy, text, *args, **kwargs):
        return super().text(xy, oled_text(str(text)), *args, **kwargs)


class Renderer:
    def __init__(self):
        self.font = ImageFont.load_default(size=10)
        self.large = ImageFont.load_default(size=12)

    def render(self, menu: Menu) -> Image.Image:
        frame = Image.new("1", (WIDTH, HEIGHT))
        draw = OledDraw(frame)
        if menu.notice is not None:
            self._notice(draw, menu)
        elif menu.alarm_visible:
            self._alarm(draw, menu)
        else:
            self._header(draw, menu)
            if menu.page is None:
                self._main(draw, menu)
            elif menu.page == MESSAGES_PAGE:
                self._messages(draw, menu)
            elif menu.page == VOICE_PAGE:
                self._voice(draw, menu)
            else:
                self._lines(draw, self._detail(menu))
            self._footer_text(draw, self._footer(menu))
        return frame

    # --- layout pieces ----------------------------------------------
    def _header(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        title = PAGES[menu.page].upper() if menu.page is not None else "MINING SYSTEM"
        draw.text((3, 0), title, font=self.font, fill=1)
        x = 124
        if menu.link.configured:
            # Filled dot: linked to the central; hollow: no link.
            draw.ellipse((x - 4, 3, x + 2, 9), outline=1, fill=1 if menu.connected else 0)
            x -= 10
        level = menu.assessment.level
        if level in (CAUTION, DANGER):
            mark = "!!" if level == DANGER else "!"
            x -= int(self.font.getlength(mark))
            draw.text((x, 0), mark, font=self.font, fill=1)
            x -= 4
        if menu.snapshot.simulated:
            x -= int(self.font.getlength("SIM"))
            draw.text((x, 0), "SIM", font=self.font, fill=1)
        draw.line((0, 12, 127, 12), fill=1)

    def _main(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        for row, index in enumerate(range(menu.offset, min(menu.offset + menu.visible_rows, len(PAGES)))):
            y = 15 + row * 13
            selected = index == menu.selected
            if selected:
                draw.rectangle((2, y, 119, y + 11), fill=1)
            color = 0 if selected else 1
            _icon(draw, index, 5, y + 2, color)
            draw.text((18, y), PAGES[index], font=self.font, fill=color)
        self._scrollbar(draw, menu.selected, len(PAGES))

    def _messages(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        if menu.message_mode == "choose":
            items = tuple(label for _, label in MESSAGES) + ("< Volver",)
            self._options(draw, items, menu.message_selected, menu.message_offset, menu.visible_rows)
            self._scrollbar(draw, menu.message_selected, len(items))
        elif menu.message_mode == "confirm":
            draw.text((3, 15), MESSAGES[menu.message_selected][1], font=self.font, fill=1)
            self._options(draw, ("Enviar", "Cancelar"), menu.confirm_selected, 0, 2, top=29)
        else:
            self._lines(draw, (menu.delivery_status, _link_text(menu), "< Volver"))

    def _voice(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        if menu.voice_mode == "recording":
            draw.text((3, 15), "Grabando", font=self.font, fill=1)
            if menu.recording_seconds % 2 == 0:
                draw.ellipse((112, 17, 118, 23), fill=1)
            draw.text((3, 30), _clock(menu.recording_seconds), font=self.large, fill=1)
        elif menu.voice_mode == "confirm":
            draw.text((3, 15), f"Duracion {_clock(menu.voice_duration_ms // 1000)}", font=self.font, fill=1)
            self._options(draw, ("Enviar", "Descartar"), menu.voice_confirm_selected, 0, 2, top=29)
        elif menu.voice_mode == "result":
            self._lines(draw, (menu.voice_status, _link_text(menu), "< Volver"))
        else:
            draw.text((3, 15), "Mensaje de voz", font=self.font, fill=1)
            self._options(draw, ("Grabar", "< Volver"), menu.voice_confirm_selected, 0, 2, top=29)

    def _notice(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        notice = menu.notice
        self._banner(draw, "AVISO CENTRAL" if notice.severity != "critical" else "AVISO URGENTE")
        self._wrapped(draw, notice.text, 18)
        if len(menu.notices) > 1:
            draw.text((3, 43), f"+{len(menu.notices) - 1} aviso(s)", font=self.font, fill=1)
        self._footer_text(draw, "ENTER: enterado")

    def _alarm(self, draw: ImageDraw.ImageDraw, menu: Menu) -> None:
        self._banner(draw, "PELIGRO")
        conditions = [condition.text for condition in menu.assessment.conditions if condition.level == DANGER]
        for index, text in enumerate(conditions[:3]):
            draw.text((3, 16 + index * 13), text, font=self.large, fill=1)
        self._footer_text(draw, "ENTER: silenciar")

    def _footer(self, menu: Menu) -> str:
        if menu.page is None:
            return f"{menu.selected + 1}/{len(PAGES)}   ENTER: abrir"
        if menu.page == MESSAGES_PAGE:
            return {"choose": "ENTER: seleccionar", "confirm": "ENTER: confirmar"}.get(menu.message_mode, "ENTER: volver")
        if menu.page == VOICE_PAGE:
            return {"recording": "ENTER: detener", "result": "ENTER: volver"}.get(menu.voice_mode, "ENTER: seleccionar")
        return "ENTER: volver"

    # --- page content -------------------------------------------------
    def _detail(self, menu: Menu) -> tuple[str, ...]:
        title = PAGES[menu.page]
        snapshot = menu.snapshot
        level = f"Nivel: {LABELS[menu.assessment.level]}"
        if title == "Estado":
            status = f"Bloqueo: {menu.link.blocked[:14]}" if menu.link.blocked else level
            return _link_text(menu), status, f"Cola: {menu.pending_messages} msg, {menu.pending_voices} voz"
        if title == "Gases":
            if snapshot.co_ppm is not None:
                value = f"CO: {snapshot.co_ppm:.0f} ppm"
            elif snapshot.co_volts is not None:
                value = f"CO: {snapshot.co_volts:.3f} V"
            else:
                value = "CO: sin lectura"
            state = {
                CO_WARMING: f"Calentando {_clock(snapshot.warmup_remaining)}",
                CO_UNCALIBRATED: "Sin calibrar (V)",
                CO_ERROR: "Sensor con error",
                CO_DISABLED: "Sensor desactivado",
                CO_OK: f"{snapshot.co_volts or 0:.3f} V calibrado",
            }[snapshot.co_state]
            return value, state, level
        if title == "Temperatura":
            if snapshot.thermometer_state == THERMOMETER_ERROR:
                return "Sensor MLX90614", "Sensor con error", level
            if snapshot.thermometer_state == THERMOMETER_DISABLED:
                return "Sensor MLX90614", "Sensor desactivado", ""
            return f"Ambiente: {_celsius(snapshot.ambient_c)}", f"Objeto: {_celsius(snapshot.object_c)}", level
        identity = menu.link.identity
        if not identity:
            return "Manilla sin identificar", "Conecta con la central", ""
        return identity.get("name", ""), identity.get("minerName") or "Sin minero asignado", identity.get("zone", "")

    # --- drawing helpers ----------------------------------------------
    def _footer_text(self, draw: ImageDraw.ImageDraw, text: str) -> None:
        draw.line((0, FOOTER_LINE, 127, FOOTER_LINE), fill=1)
        draw.text((3, FOOTER_TEXT), text, font=self.font, fill=1)

    def _lines(self, draw: ImageDraw.ImageDraw, lines: tuple[str, ...]) -> None:
        for y, line in zip(LINES, lines):
            draw.text((3, y), line, font=self.font, fill=1)

    def _options(self, draw: ImageDraw.ImageDraw, items: tuple[str, ...], selected: int, offset: int, rows: int, top: int = 15) -> None:
        for row, index in enumerate(range(offset, min(offset + rows, len(items)))):
            y = top + row * 13
            if index == selected:
                draw.rectangle((2, y, 119, y + 11), fill=1)
            draw.text((5, y), items[index], font=self.font, fill=0 if index == selected else 1)

    def _banner(self, draw: ImageDraw.ImageDraw, text: str) -> None:
        draw.rectangle((0, 0, 127, 12), fill=1)
        draw.text((3, 0), text, font=self.font, fill=0)

    def _wrapped(self, draw: ImageDraw.ImageDraw, text: str, top: int) -> None:
        lines, current = [], ""
        for word in text.split():
            candidate = f"{current} {word}".strip()
            if self.large.getlength(candidate) <= 122 or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
        for index, line in enumerate(lines[:2]):
            draw.text((3, top + index * 13), line, font=self.large, fill=1)

    @staticmethod
    def _scrollbar(draw: ImageDraw.ImageDraw, selected: int, count: int) -> None:
        draw.line((124, 16, 124, 51), fill=1)
        top = 16 + round(selected * 28 / max(1, count - 1))
        draw.rectangle((123, top, 125, top + 7), fill=1)


def _link_text(menu: Menu) -> str:
    if not menu.link.configured:
        return "Central: sin configurar"
    return "Central: conectada" if menu.connected else "Central: sin enlace"


def _celsius(value: float | None) -> str:
    return "--" if value is None else f"{value:.1f} °C"


def _clock(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def _icon(draw: ImageDraw.ImageDraw, index: int, x: int, y: int, color: int) -> None:
    if index == 0:  # Estado: monitor
        draw.rectangle((x, y, x + 8, y + 6), outline=color)
        draw.line((x + 2, y + 8, x + 6, y + 8), fill=color)
    elif index == 1:  # Gases: bubbles
        draw.ellipse((x, y + 3, x + 5, y + 8), outline=color)
        draw.ellipse((x + 3, y, x + 8, y + 5), outline=color)
    elif index == 2:  # Temperatura: thermometer
        draw.rectangle((x + 3, y, x + 5, y + 5), outline=color)
        draw.ellipse((x + 2, y + 4, x + 6, y + 8), outline=color)
    elif index == 3:  # Mensajes: speech bubble
        draw.rectangle((x, y, x + 8, y + 6), outline=color)
        draw.line((x + 2, y + 6, x + 2, y + 8), fill=color)
    elif index == 4:  # Voz: microphone
        draw.rounded_rectangle((x + 2, y, x + 6, y + 5), radius=2, outline=color)
        draw.arc((x, y + 1, x + 8, y + 7), 0, 180, fill=color)
        draw.line((x + 4, y + 7, x + 4, y + 8), fill=color)
    else:  # Ajustes
        draw.ellipse((x, y, x + 8, y + 8), outline=color)
        draw.rectangle((x + 3, y + 3, x + 5, y + 5), fill=color)
