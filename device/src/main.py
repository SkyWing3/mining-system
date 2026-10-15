"""Ejecutar desde device: python -m src.main --simulate --config config/settings.json."""
from __future__ import annotations

import argparse
import logging

from .config import DEFAULT_CONFIG, load_config
from .display.menu import Menu
from .display.renderer import Renderer


def main() -> None:
    parser = argparse.ArgumentParser(description="Manilla minera: OLED, sensores, alertas, voz y enlace con la central")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--simulate", action="store_true",
                        help="Ventana con botones, sensores y salidas simulados; no requiere GPIO, I2C ni micrófono")
    parser.add_argument("--preview", help="Guardar el menú como PNG sin abrir una ventana")
    parser.add_argument("--verbose", action="store_true", help="Mostrar el registro detallado")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.preview:
        Renderer().render(Menu()).save(args.preview)
        return

    app = None
    try:
        from .app import Application
        app = Application(load_config(args.config), simulate=args.simulate)
        if args.simulate:
            from .simulator import run_simulator
            run_simulator(app)
        else:
            app.run_hardware()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, ImportError) as error:
        parser.exit(1, f"No se pudo iniciar la manilla: {error}\n")
    finally:
        if app is not None:
            app.close()


if __name__ == "__main__":
    main()
