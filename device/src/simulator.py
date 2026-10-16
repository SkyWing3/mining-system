"""Ventana Tk que reproduce la OLED, los botones y las salidas de alerta sin hardware."""
from __future__ import annotations

import time
from queue import Empty

from .alerts.outputs import SimulatedOutputs
from .app import Application
from .events import Action
from .sensors.sources import SimulatedSensors

BACKGROUND = "#181818"
# Same keys as alerts.outputs.COLORS.
LED_COLORS = {"off": "#2a2a2a", "green": "#2fbf4a", "yellow": "#e6c229", "red": "#e5383b", "blue": "#3a7bd5"}


def run_simulator(app: Application) -> None:
    import tkinter as tk
    from PIL import ImageTk

    root = tk.Tk()
    root.title("Mining System · Manilla simulada")
    root.configure(bg=BACKGROUND)
    screen = tk.Label(root, bg=BACKGROUND, padx=16, pady=16)
    screen.pack()

    status = tk.Frame(root, bg=BACKGROUND)
    status.pack(pady=(0, 8))
    led = tk.Canvas(status, width=22, height=22, bg=BACKGROUND, highlightthickness=0)
    led_dot = led.create_oval(3, 3, 19, 19, fill=LED_COLORS["off"], outline="")
    led.pack(side="left", padx=6)
    outputs_label = tk.Label(status, bg=BACKGROUND, fg="#d0d0d0", font=("Helvetica", 12))
    outputs_label.pack(side="left", padx=6)

    controls = tk.Frame(root, bg=BACKGROUND)
    controls.pack(pady=4)
    for caption, action, key in (("↑ Subir", Action.UP, "<Up>"), ("↓ Bajar", Action.DOWN, "<Down>"), ("↵ Enter", Action.ENTER, "<Return>")):
        tk.Button(controls, text=caption, command=lambda event=action: app.events.put(event)).pack(side="left", padx=6)
        root.bind(key, lambda _, event=action: app.events.put(event))

    sensors = app.sensors if isinstance(app.sensors, SimulatedSensors) else None
    if sensors is not None:
        spikes = tk.Frame(root, bg=BACKGROUND)
        spikes.pack(pady=(4, 12))
        tk.Button(spikes, text="Pico de CO (g)", command=sensors.spike_gas).pack(side="left", padx=6)
        tk.Button(spikes, text="Pico de calor (t)", command=sensors.spike_heat).pack(side="left", padx=6)
        root.bind("g", lambda _: sensors.spike_gas())
        root.bind("t", lambda _: sensors.spike_heat())
    root.bind("<Escape>", lambda _: root.destroy())

    outputs = app.outputs if isinstance(app.outputs, SimulatedOutputs) else None
    state = {"next_tick": time.monotonic(), "frame": None}

    def pump() -> None:
        while True:
            try:
                app.process(app.events.get_nowait())
            except Empty:
                break
        if time.monotonic() >= state["next_tick"]:
            app.tick()
            state["next_tick"] = time.monotonic() + 1
        frame = app.renderer.render(app.menu)
        if frame.tobytes() != state["frame"]:
            state["frame"] = frame.tobytes()
            image = ImageTk.PhotoImage(frame.convert("RGB").resize((512, 256), resample=0))
            screen.image = image
            screen.configure(image=image)
        if outputs is not None:
            led.itemconfigure(led_dot, fill=LED_COLORS[outputs.led_color if outputs.led_lit() else "off"])
            buzzer = "Buzzer: SONANDO" if outputs.buzzer_on() else "Buzzer: en silencio"
            motor = "Motor: VIBRANDO" if outputs.motor_on() else "Motor: detenido"
            outputs_label.configure(text=f"{buzzer}   ·   {motor}")
        root.after(100, pump)

    app.start()
    pump()
    root.mainloop()
