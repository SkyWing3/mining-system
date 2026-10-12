"""Ejecutar desde device: python -m src.main --simulate."""
import argparse
from queue import Queue, Empty
from .config import DEFAULT_CONFIG, load_config
from .display.menu import Action, Menu
from .display.renderer import Renderer
from .communication.client import DeviceClient, TransportEvent


def simulate(menu, renderer, events=None):
    import tkinter as tk
    from PIL import ImageTk
    root = tk.Tk()
    root.title("Mining System · OLED 128x64")
    root.configure(bg="#181818")
    label = tk.Label(root, bg="#181818", padx=16, pady=16)
    label.pack()

    def redraw(action=None):
        if action is not None:
            menu.handle(action)
        frame = renderer.render(menu).convert("RGB").resize((640, 320), resample=0)
        label.image = ImageTk.PhotoImage(frame)
        label.configure(image=label.image)

    controls = tk.Frame(root, bg="#181818")
    controls.pack(pady=12)
    for caption, action, key in (("↑ Subir", Action.UP, "<Up>"), ("↓ Bajar", Action.DOWN, "<Down>"), ("↵ Enter", Action.ENTER, "<Return>")):
        tk.Button(controls, text=caption, command=lambda event=action: redraw(event)).pack(side="left", padx=6)
        root.bind(key, lambda _, event=action: redraw(event))
    root.bind("<Escape>", lambda _: root.destroy())
    def update():
        if events:
            while not events.empty():
                menu.transport(events.get_nowait())
            redraw()
        root.after(150, update)
    redraw()
    update()
    root.mainloop()


def hardware(config, menu, renderer, queue):
    from luma.core.interface.serial import i2c
    from luma.oled.device import ssd1306
    from .input.buttons import Buttons
    screen = ssd1306(i2c(port=config["display"]["port"], address=config["display"]["address"]), width=128, height=64, rotate=config["display"]["rotate"])
    try:
        buttons = Buttons(config["buttons"], queue)
        try:
            screen.display(renderer.render(menu))
            while True:
                try:
                    event = queue.get(timeout=1)
                except Empty:
                    continue
                if isinstance(event, TransportEvent):
                    menu.transport(event)
                else:
                    menu.handle(event)
                screen.display(renderer.render(menu))
        finally:
            buttons.close()
    finally:
        screen.cleanup()


def main():
    parser = argparse.ArgumentParser(description="Menú de la manilla minera")
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--simulate", action="store_true", help="Ventana con botones y teclado; no requiere GPIO")
    parser.add_argument("--preview", help="Guardar el menú como PNG sin abrir una ventana")
    args = parser.parse_args()
    menu, renderer = Menu(), Renderer()
    client = None
    try:
        if args.preview:
            renderer.render(menu).save(args.preview)
        else:
            config, events = load_config(args.config), Queue()
            connection = config.get("connection")
            if connection and connection.get("api_key"):
                client = DeviceClient(connection, events)
                menu.sender = client.send
                client.start()
            if args.simulate:
                simulate(menu, renderer, events)
            else:
                hardware(config, menu, renderer, events)
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, ImportError) as error:
        parser.exit(1, f"No se pudo iniciar la interfaz: {error}\n")
    finally:
        if client:
            client.close()


if __name__ == "__main__":
    main()
