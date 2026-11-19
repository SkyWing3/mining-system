# Manilla minera en ESP32-S3

Firmware de la manilla para **ESP32-S3 DevKitC-1** con PlatformIO. Es un port de
[`device/`](../device) (Python en Raspberry Pi Zero 2 W): mismo menú, mismas
reglas de alerta, misma cola durable y **el mismo protocolo con la central**,
así que el backend y la web no cambian.

Componentes usados: termómetro infrarrojo MLX90614, sensor de CO SEN0564, tres
pulsadores, LED RGB, buzzer activo, micrófono digital INMP441, OLED SSD1306 y
micromotor vibrador. El ADS1115 ya no hace falta: el SEN0564 se lee con el ADC
interno del ESP32-S3.

> El firmware compila y su lógica pasa las pruebas en el computador, pero
> **todavía no se ha probado en una placa**. Ver [Pendiente de validar](#pendiente-de-validar-en-la-placa).

## Compilar, grabar y probar

```sh
cd esp32-device
pio run -e esp32-s3-n16r8 -t upload    # placa con módulo N16R8 (16 MB de flash)
pio run -e esp32-s3-n8 -t upload       # módulos N8, N8R2 o N8R8 (8 MB de flash)
pio device monitor                     # consola serie a 115200 baudios
pio test -e native                     # 67 pruebas de la lógica, sin placa
```

El módulo está serigrafiado en la placa (por ejemplo `ESP32-S3-WROOM-1 N16R8`).
Se puede grabar y usar la consola por cualquiera de los dos conectores: el
**UART/COM** (chip USB-serie) o el **USB** nativo (en macOS aparece como
`/dev/cu.usbmodem…`). En el primer arranque LittleFS se formatea solo.

Si la grabación no arranca, mantener **BOOT** presionado al conectar la placa
fuerza el modo de descarga. Después de grabar hay que soltar BOOT y presionar
**RST** una vez: mientras la placa está en modo de descarga, el firmware no se
ejecuta.

## Conexiones

Todos los módulos se alimentan con **3,3 V** desde el pin 3V3 de la placa, como en
la Raspberry Pi. Los números de pin de J1 corresponden a la DevKitC-1 de
Espressif; en clones, guiarse por la serigrafía `GPIOn`.

| Componente | Señal | GPIO | Pin J1 |
| --- | --- | --- | --- |
| Alimentación | 3V3 / GND | — | 1-2 / 22 |
| SEN0564 (CO) | salida analógica A | 4 (ADC1) | 4 |
| Pulsador subir / bajar / enter | a GND (pull-up interno) | 5 / 6 / 7 | 5 / 6 / 7 |
| LED RGB | R / G / B | 15 / 16 / 17 | 8 / 9 / 10 |
| Buzzer activo | I/O (activo en bajo) | 18 | 11 |
| OLED SSD1306 y MLX90614 | SDA | 8 | 12 |
| OLED SSD1306 y MLX90614 | SCL | 9 | 15 |
| Micromotor | base del NPN por 1 kΩ | 10 | 16 |
| INMP441 | SCK / WS / SD | 12 / 13 / 14 | 18 / 19 / 20 |
| INMP441 | L/R | GND | — |

- **Motor**: la misma etapa de [conexiones.tex](../docs/conexiones.tex) (NPN,
  1 kΩ a la base, 10 kΩ base-GND, diodo de rueda libre y 100 nF). Se recomienda
  un condensador de 100-470 µF entre 3V3 y GND cerca del motor: el arranque del
  motor coincide a veces con los picos de transmisión del Wi-Fi y una caída
  de tensión reinicia el ESP32 (brownout).
- **SEN0564**: va directo al GPIO 4. Con atenuación de 11 dB el ADC del S3 mide
  hasta ~3,1 V; por encima la lectura se satura.
- **Pines que no se usan**: 0, 3, 45 y 46 (arranque), 19 y 20 (USB), 26-37
  (flash/PSRAM), 38 y 48 (LED RGB de la placa), 43 y 44 (consola). La
  configuración los rechaza, igual que los pines repetidos y el CO en un pin sin
  ADC1 (el ADC2 no funciona con el Wi-Fi activo).

## Configuración

La configuración vive en la flash (`/settings.json` en LittleFS) y se cambia por
la consola serie; no hace falta recompilar. Tiene el mismo formato que
`device/config/settings.json`, con estas diferencias:

| Nuevo en el ESP32 | Ya no existe |
| --- | --- |
| `wifi.ssid`, `wifi.password` | `display.port`, `sensors.i2c_port` |
| `i2c.sda`, `i2c.scl`, `i2c.frequency` (máx. 100 kHz por el MLX90614) | `sensors.ads1115` |
| `sensors.co.pin` (en lugar de `channel`), `samples` hasta 64 | `connection.outbox_path`, `voice_outbox_path` |
| `sensors.simulated`: lecturas sintéticas para demostraciones | `voice.alsa_device` |
| `voice.pins.sck/ws/sd`, `voice.slot` (`left` o `right`) | |

[`config/settings.example.json`](config/settings.example.json) tiene todos los
valores por defecto. Para la primera configuración basta con el Wi-Fi y la
credencial que genera la web al registrar la manilla:

```text
config set {"wifi":{"ssid":"RedMina","password":"clave-wifi"},"connection":{"url":"ws://192.168.1.20/ws/device","api_key":"<64 caracteres>"}}
```

`config set` combina el JSON con la configuración guardada, la valida y reinicia
la placa; un valor `null` borra la clave. También se puede enviar un archivo:

```sh
cp config/settings.example.json config/settings.json   # no se versiona
~/.platformio/penv/bin/python tools/configure.py --port /dev/cu.usbserial-0001 config/settings.json
```

Si la configuración guardada es inválida, la OLED muestra el error y solo
queda activa la consola para corregirla (modo seguro).

### Consola serie

| Comando | Uso |
| --- | --- |
| `status` | Wi-Fi, central, hora, colas, lecturas, flash y RAM libres |
| `config` | configuración actual (contraseña y credencial ocultas) |
| `config set {json}` / `config reset` | cambiar la configuración / volver a la de fábrica |
| `calibrate co baseline [s]` | línea base en aire limpio (60 s por defecto) |
| `calibrate co reference <ppm> [s]` | medición con gas de referencia; guarda y aplica la calibración |
| `calibrate co clear` | borra la calibración (vuelve a informar voltios) |
| `simulate gas` / `simulate heat` | picos de prueba con `sensors.simulated` |
| `i2c scan` | dispositivos del bus I2C (OLED 0x3C, MLX90614 0x5A) |
| `test outputs` | LED rojo, verde y azul, dos pitidos y una vibración |
| `test buttons [s]` | muestra cada pulsación y un resumen (30 s por defecto) |
| `restart` | reiniciar |

La calibración reemplaza a `python -m src.tools.calibrate_co` y se aplica sin
reiniciar, así el sensor no vuelve a precalentarse. **Hay que repetirla**: los
valores del ADS1115 no sirven para el ADC del ESP32.

## Arquitectura

- `lib/core/`: lógica sin dependencias de Arduino, traducida de los módulos de
  Python: configuración (`config.py`), menú y pantalla (`display/`), umbrales y
  alertas (`alerts/`), sensores y telemetría (`sensors/`), cola de mensajes y
  de voz (`communication/outbox.py`, `voice_queue.py`), protocolo con la
  central (`communication/client.py`) y orquestación (`app.py`). Se prueba en el
  computador con `pio test -e native`.
- `src/`: controladores del ESP32-S3 (LittleFS, I2C, ADC, I2S, U8g2, GPIO),
  Wi-Fi, WebSocket, subida HTTP y consola, cada uno en su tarea de FreeRTOS.
  Como en Python, solo la tarea principal cambia el estado; las demás publican
  eventos en una cola.
- `test/`: equivalentes de `device/tests` (alertas, menú y pantalla,
  configuración, colas, protocolo, sensores y aplicación).

## Diferencias con la versión para Raspberry Pi

- **Hora**: el ESP32 no tiene reloj y en la mina no suele haber NTP. La manilla
  toma la hora del campo `serverTime` de cada `ack` de la central. Lo que se
  encola antes de la primera sincronización se fecha al enviarlo, a partir del
  tiempo desde el arranque. Si la manilla se reinicia sin haber sincronizado,
  esos mensajes llevan la hora del envío.
- **Voz**: se graba directamente a un WAV en la flash (sin PSRAM) y la
  normalización se aplica al subirla. La cola de voz queda limitada por la
  flash: unas 13 grabaciones de 30 s a 16 kHz con 16 MB y unas 5 con 8 MB,
  además de `voice.max_pending`. Con poco espacio, la OLED muestra
  **Memoria llena**.
- **Mensajes**: la cola admite 256 entradas. Lo que la central rechaza no se
  conserva, solo se anota en `/rejected.log`.
- **Conexión**: solo `ws://` en la red local; `wss://` no está implementado. Los
  nombres `.local` se resuelven por mDNS.
- **OLED**: fuentes de U8g2 (Helvetica 8 y 10). Ahora se ven las tildes y la ñ.
- **Sin simulador de escritorio**: para probar sin sensores se usa
  `sensors.simulated`. Las pruebas de la lógica se ejecutan con `pio test`.
- **Actualizaciones** por USB (sin OTA). La credencial y la contraseña Wi-Fi
  quedan en la flash sin cifrar, como antes en la tarjeta SD.

## Pendiente de validar en la placa

- Si la grabación queda en silencio, cambiar `voice.slot` a `right` (depende
  del orden de canales del I2S).
- Posición vertical del texto en la OLED (desplazamientos de `src/display.cpp`).
- Lecturas del MLX90614 a 100 kHz con el controlador I2C del ESP32 (se verifica
  el PEC de cada lectura).
- Ganancia del micrófono: preamplificación fija de +18 dB más normalización
  de hasta 8 veces; ajustar si el audio satura o queda bajo.
- Consumo real y autonomía con batería.
