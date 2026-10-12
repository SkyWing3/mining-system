"""Fotograma monocromo 128x64 compatible con SSD1306 y simulador."""
from PIL import Image, ImageDraw, ImageFont
from .menu import PAGES
from ..communication.catalog import MESSAGES


class Renderer:
    def __init__(self):
        self.font = ImageFont.load_default(size=10)

    def render(self, menu):
        frame = Image.new("1", (128, 64))
        draw = ImageDraw.Draw(frame)
        draw.text((3, 0), menu.page.title.upper() if menu.page else "MINING SYSTEM", font=self.font, fill=1)
        draw.line((0, 12, 127, 12), fill=1)
        if menu.message_mode:
            self._messages(draw, menu)
        elif menu.page:
            lines = ("Central: conectada" if menu.connected else "Central: sin enlace", "Manilla operativa") if menu.page.title == "Estado" else menu.page.lines
            for index, line in enumerate(lines):
                draw.text((3, 17 + index * 12), line, font=self.font, fill=1)
            draw.rectangle((2, 43, 119, 54), fill=1)
            draw.text((5, 43), "< Volver", font=self.font, fill=0)
        else:
            for row, index in enumerate(range(menu.offset, min(menu.offset + 3, len(PAGES)))):
                y = 15 + row * 13
                selected = index == menu.selected
                if selected:
                    draw.rectangle((2, y, 119, y + 11), fill=1)
                color = 0 if selected else 1
                self._icon(draw, index, 5, y + 2, color)
                draw.text((18, y), PAGES[index].title, font=self.font, fill=color)
            draw.line((124, 16, 124, 51), fill=1)
            top = 16 + round(menu.selected * 28 / (len(PAGES) - 1))
            draw.rectangle((123, top, 125, top + 7), fill=1)
        draw.line((0, 56, 127, 56), fill=1)
        footer = "ENTER: seleccionar" if menu.message_mode == "choose" else "ENTER: confirmar" if menu.message_mode == "confirm" else "ENTER: volver" if menu.page else f"{menu.selected + 1}/{len(PAGES)}   ENTER: abrir"
        draw.text((3, 56), footer, font=self.font, fill=1)
        return frame

    def _messages(self, draw, menu):
        if menu.message_mode == "choose":
            items = tuple(label for _, label in MESSAGES) + ("< Volver",)
            for row, index in enumerate(range(menu.message_offset, min(menu.message_offset + 3, len(items)))):
                y = 15 + row * 13
                selected = index == menu.message_selected
                if selected:
                    draw.rectangle((2, y, 119, y + 11), fill=1)
                draw.text((5, y), items[index], font=self.font, fill=0 if selected else 1)
            draw.line((124, 16, 124, 51), fill=1)
            top = 16 + round(menu.message_selected * 28 / (len(items) - 1))
            draw.rectangle((123, top, 125, top + 7), fill=1)
        elif menu.message_mode == "confirm":
            draw.text((3, 15), MESSAGES[menu.message_selected][1], font=self.font, fill=1)
            for index, label in enumerate(("Enviar", "Cancelar")):
                y = 29 + index * 13
                selected = index == menu.confirm_selected
                if selected:
                    draw.rectangle((2, y, 119, y + 11), fill=1)
                draw.text((5, y), label, font=self.font, fill=0 if selected else 1)
        else:
            draw.text((3, 17), menu.delivery_status, font=self.font, fill=1)
            draw.text((3, 30), "Central conectada" if menu.connected else "Central sin enlace", font=self.font, fill=1)
            draw.text((3, 43), "< Volver", font=self.font, fill=1)

    @staticmethod
    def _icon(draw, index, x, y, color):
        if index == 0:
            draw.rectangle((x, y, x + 8, y + 6), outline=color)
            draw.line((x + 2, y + 8, x + 6, y + 8), fill=color)
        elif index == 1:
            draw.ellipse((x, y + 3, x + 5, y + 8), outline=color)
            draw.ellipse((x + 3, y, x + 8, y + 5), outline=color)
        elif index == 2:
            draw.rectangle((x + 3, y, x + 5, y + 5), outline=color)
            draw.ellipse((x + 2, y + 4, x + 6, y + 8), outline=color)
        elif index == 3:
            draw.rectangle((x, y, x + 8, y + 6), outline=color)
            draw.line((x + 2, y + 6, x + 2, y + 8), fill=color)
        else:
            draw.ellipse((x, y, x + 8, y + 8), outline=color)
            draw.rectangle((x + 3, y + 3, x + 5, y + 5), fill=color)
