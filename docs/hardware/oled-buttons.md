# OLED, sensores, alertas y voz de la manilla

Software de la manilla para Raspberry Pi Zero 2 W: OLED SSD1306 I²C de 128×64, tres pulsadores, sensor de CO SEN0564 leído mediante un ADS1115, termómetro infrarrojo MLX90614, micrófono I²S INMP441, LED RGB, buzzer activo y micro motor vibrador. La interfaz es monocromática: iconos simples, selección invertida, tres filas visibles, barra de desplazamiento y contador de opciones.

Consultar también [la lista de componentes](../componentes.tex), [el diagrama de cableado](../imagenes/cableado.png) y [el documento de cableado completo y puesta en marcha](../conexiones.tex), que incluye mapa de pines, alimentación, `config.txt` y pruebas por etapas.

![Vista previa del menú OLED](../imagenes/oled-menu-preview.png)

## Conexiones

| Elemento | Señal | GPIO BCM | Pin físico |
| --- | --- | --- | --- |
| OLED, ADS1115, MLX90614 | SDA / SCL | 2 / 3 | 3 / 5 |
| Botón subir / bajar / enter | Un contacto (el otro a GND) | 17 / 27 / 22 | 11 / 13 / 15 |
| INMP441 | SCK / WS / SD | 18 / 19 / 20 | 12 / 35 / 38 |
| Motor vibrador | Base del NPN (1 kΩ) | 23 | 16 |
| Buzzer activo | I/O | 24 | 18 |
| LED RGB | R / G / B | 5 / 6 / 13 | 29 / 31 / 33 |

Todos los módulos se alimentan a 3,3 V (pin 1) y comparten GND (pin 6). Direcciones I²C: OLED `0x3C`, ADS1115 `0x48`, MLX90614 `0x5A`. La configuración rechaza pines repetidos, botones o salidas en los GPIO reservados para I²C (2, 3) e I²S (16, 18–21), y una salida en el mismo GPIO que un botón.

## Preparación de la Raspberry Pi

```sh
sudo apt update
sudo apt install python3-venv python3-pip python3-dev python3-lgpio \
  build-essential swig i2c-tools alsa-utils libjpeg-dev zlib1g-dev libfreetype6-dev
```

Habilitar I²C y el overlay del micrófono en `/boot/firmware/config.txt` según [conexiones](../conexiones.tex) (`dtparam=i2c_arm=on`, `dtoverlay=googlevoicehat-soundcard` y las líneas `gpio=` que dejan las alertas apagadas al arrancar). Después:

```sh
i2cdetect -y 1          # debe mostrar 3c, 48 y 5a
arecord -L | grep -i googlevoi
cd device
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n config/settings.example.json config/settings.json
GPIOZERO_PIN_FACTORY=lgpio .venv/bin/python -m src.main --config config/settings.json
```

El usuario debe pertenecer a los grupos `i2c`, `gpio` y `audio`. Los pines del JSON usan numeración BCM, no números físicos. `display.rotate: 2` gira la OLED 180 grados. La configuración local `settings.json` queda excluida de Git.

## Configuración

| Sección | Campos principales | Por defecto |
| --- | --- | --- |
| `connection` | `url`, `api_key`, `telemetry_seconds`, `heartbeat_seconds`, `outbox_path`, `voice_outbox_path` | 2 s de telemetría, 20 s de heartbeat |
| `sensors` | `sample_seconds`, `ads1115.address`, `co.{enabled, channel, samples, warmup_seconds, calibration}`, `mlx90614.{enabled, address}` | 1 s, canal A0, 180 s de precalentamiento, sin calibración |
| `alerts` | `led.{red, green, blue, active_high}`, `buzzer.{pin, active_high}`, `motor.pin`, `button_feedback`, `silence_seconds`, `confirm_samples`, `thresholds` | LED de cátodo común, buzzer activo en bajo, 60 s de silencio, 3 muestras |
| `voice` | `enabled`, `alsa_device`, `sample_rate`, `max_seconds`, `max_pending` | `plughw:CARD=sndrpigooglevoi,DEV=0`, 16 kHz, 30 s, 20 pendientes |

Si el buzzer suena con nivel alto, usar `"active_high": true`; si el LED es de ánodo común, `"active_high": false`. Comprobarlo con la etapa 4 de [conexiones](../conexiones.tex). Si `arecord -L` muestra otro nombre de tarjeta, ajustar `voice.alsa_device`.

## Lecturas y calibración del CO

Un hilo muestrea los sensores cada `sample_seconds`; un fallo de I²C en un sensor no detiene al otro y la OLED muestra **Sensor con error**. El cliente de red transmite la última muestra cada `telemetry_seconds` como telemetría en vivo (ver [API](../api.md)).

El SEN0564 es un sensor **cualitativo**. Durante el precalentamiento la manilla muestra **Calentando m:ss** y no informa ppm. Sin calibración muestra y transmite la tensión de A0 (**Sin calibrar (V)**) y no alarma por CO. Para calibrar, con el sensor precalentado:

```sh
.venv/bin/python -m src.tools.calibrate_co --config config/settings.json --reference-ppm 100
```

La herramienta mide la línea base en aire limpio y, con un gas de referencia de concentración conocida, calcula la pendiente. Copiar el bloque impreso en `sensors.co.calibration`:

```json
"calibration": { "baseline_volts": 0.1213, "ppm_per_volt": 412.5 }
```

Las ppm se calculan como `(V − baseline_volts) × ppm_per_volt`, nunca negativas. La calibración de dos puntos es una aproximación lineal; repetirla periódicamente y validarla con un equipo de referencia.

## Niveles y alertas

Cada métrica (CO, temperatura ambiente y de objeto) se clasifica con sus umbrales `caution` y `danger`. Un cambio de nivel exige `confirm_samples` muestras consecutivas, y para bajar la lectura debe alejarse del umbral (5 ppm, 1 °C o 2 °C). Una lectura ausente no cambia el nivel. Umbrales por defecto: CO 35/200 ppm, ambiente 32/38 °C y objeto 60/90 °C; ajustarlos a la normativa y al análisis de riesgos de cada operación.

| Situación | LED RGB | Buzzer | Motor |
| --- | --- | --- | --- |
| Normal y enlazado | Verde | — | — |
| Sin enlace con la central | Azul fijo | — | — |
| Precaución | Amarillo | Un pitido corto al entrar | — |
| Peligro | Rojo intermitente | Intermitente hasta silenciar | Vibración larga repetida |
| Aviso de la central | Azul intermitente | 3 pitidos (crítico) o 1 | Vibración doble |
| Pulsación de un botón | — | — | Vibración corta |

Al entrar en peligro la OLED muestra **PELIGRO** con los valores; **Enter** silencia buzzer y motor durante `silence_seconds`. Si el peligro continúa, la alarma se reanuda; el LED rojo se mantiene. Además, la manilla envía una vez por transición **Alarma de CO** o **Alarma de temperatura** a la central, con el valor medido; se rearma cuando el grupo vuelve a normal.

## Controles y pantallas

Opciones del menú: **Estado**, **Gases**, **Temperatura**, **Mensajes**, **Voz** y **Ajustes**.

- Subir/bajar mueve la selección; al llegar al extremo pasa al otro extremo. Enter abre la opción seleccionada; en una pantalla de detalle, Enter vuelve al menú.
- **Estado**: enlace con la central, nivel actual (o el bloqueo informado por la central, por ejemplo una manilla sin minero) y elementos en cola.
- **Gases** y **Temperatura**: valores en vivo, estado del sensor y nivel.
- **Mensajes**: ocho reportes predeterminados y “Volver”. Enter abre la confirmación; **Enviar** o **Cancelar**. El resultado muestra **Guardado en cola** hasta recibir confirmación y después **Enviado a central**. Sin credencial muestra **Sin configurar**.
- **Voz**: **Grabar** inicia la grabación (contador en pantalla); Enter la detiene, y al llegar a `max_seconds` se detiene sola. Luego **Enviar** la guarda en la cola de voz o **Descartar** la elimina. El resultado pasa a **Enviado a central** cuando la central confirma la subida.
- **Ajustes**: nombre de la manilla, minero asignado y zona, recibidos de la central.
- Cabecera: punto lleno con enlace o hueco sin enlace, `!`/`!!` en precaución/peligro y `SIM` con sensores simulados.
- Un **aviso de la central** ocupa toda la pantalla (**AVISO CENTRAL** o **AVISO URGENTE**); Enter lo marca como leído y la central lo registra. Los avisos tienen prioridad sobre la alarma de peligro.
- Una pulsación produce una acción; mantener pulsado no repite. Antirrebote: 80 ms, configurable. Ctrl+C termina el proceso y apaga pantalla, salidas y GPIO.

La fuente de la OLED no incluye tildes: los nombres recibidos se muestran sin ellas (por ejemplo, “Galeria norte”).

## Probar sin hardware

```sh
cd device
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m src.main --simulate --config config/settings.json
```

Usar las flechas y Enter, o los botones de la ventana; `g` y `t` fuerzan picos de CO y de calor. La ventana muestra el LED, el buzzer y el motor. Escape cierra el simulador. En Linux puede ser necesario instalar `python3-tk`; para Python de Homebrew en macOS, `brew install python-tk@3.14`. El simulador marca sus lecturas como simuladas y su voz es un tono sintético.

Para generar una imagen sin ventana y ejecutar las pruebas:

```sh
.venv/bin/python -m src.main --preview /tmp/mining-menu.png
.venv/bin/python -m unittest discover -s tests -v
```

## Organización del código

| Módulo | Responsabilidad |
| --- | --- |
| `src/main.py` | Línea de comandos. |
| `src/app.py` | Orquestación: un hilo principal consume los eventos de botones, sensores, red y voz, y redibuja la OLED. |
| `src/config.py` | Configuración tipada y validada. |
| `src/sensors/` | ADS1115, MLX90614, SEN0564, fuentes física y simulada, muestreo periódico. |
| `src/alerts/` | Niveles con histéresis, reglas de aviso y salidas GPIO o simuladas. |
| `src/audio/` | Grabación con `arecord` y procesamiento WAV. |
| `src/communication/` | Catálogos, colas durables, cliente WebSocket y subida de voz. |
| `src/display/` | Máquina de estados del menú y renderizador 128×64. |
| `src/input/` | Pulsadores. |
| `src/tools/` | Calibración del CO. |

Los callbacks GPIO y los hilos de sensores y red solo encolan eventos; todas las decisiones y el dibujo ocurren en el hilo principal. La lógica se verifica sin hardware con dobles de I²C, GPIO, `arecord`, WebSocket y HTTP. Falta validar en la placa física el cableado, los rebotes reales, la polaridad del buzzer y del LED, la ganancia del micrófono y la calibración del sensor.

Referencias: [Luma.OLED](https://luma-oled.readthedocs.io/en/stable/python-usage.html), [GPIO Zero](https://gpiozero.readthedocs.io/en/stable/api_output.html), [smbus2](https://pypi.org/project/smbus2/), [ADS1115](https://www.ti.com/lit/ds/symlink/ads1115.pdf), [MLX90614](https://www.melexis.com/-/media/files/documents/datasheets/mlx90614-datasheet-melexis.pdf), [SEN0564](https://wiki.dfrobot.com/SKU_SEN0564_Fermion_MEMS_CO_Sensor_breakout).
