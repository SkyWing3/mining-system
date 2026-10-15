# Diagrama Wokwi de la manilla minera

Conexiones tomadas de [conexiones.pdf](../conexiones.pdf), fechado el 14 de
octubre de 2026. Se conserva la Raspberry Pi Zero 2 W y la asignación de GPIO
del documento.

## Archivos

- [diagrama.html](diagrama.html): vista ilustrada con fondo oscuro, componentes
  con aspecto físico, cables visibles, zoom y descargas;
  abrir directamente en un navegador, sin servidor ni acceso a Internet.
- [diagrama.svg](diagrama.svg), [diagrama.png](diagrama.png) y
  [diagrama.pdf](diagrama.pdf): versiones para insertar en documentos.
- [diagram.json](diagram.json): componentes, posiciones y 51 conexiones en
  formato Wokwi. Contiene todos los cables de alimentación explícitos.
- `*.chip.json`: nombres y terminales de los componentes personalizados.
- `*.chip.c`: implementaciones vacías para la representación gráfica.
- [wokwi.toml](wokwi.toml): registro de los chips personalizados.

## Validación con wokwi-cli

Desde la raíz del repositorio:

```sh
wokwi-cli lint --warnings-as-errors docs/wokwi
```

También puede ejecutarse sin consultar el registro remoto:

```sh
wokwi-cli lint --offline --warnings-as-errors docs/wokwi
```

Validado con Wokwi CLI 0.28.1, sin errores ni advertencias. Además se contrastaron
las 21 redes eléctricas con las tablas del PDF, comprobando que alimentación,
señales y salidas no estén unidas entre sí por error.

La CLI valida el archivo Wokwi. La vista SVG/HTML se dibuja localmente desde las
mismas conexiones mediante `ilustrar.py`; PNG y PDF se exportan desde esa vista.
Los pulsadores, el LED RGB y las resistencias usan SVG originales de
[@wokwi/elements 1.9.2](https://github.com/wokwi/wokwi-elements), con licencia MIT
incluida en `assets/WOKWI-ELEMENTS-LICENSE`. Los demás módulos son ilustraciones
SVG propias basadas en las imágenes de `docs/imagenes`, con sus terminales del
proyecto. La vista es un dibujo de montaje, no una captura del simulador web.

## Representación en Wokwi

Wokwi no incluye la Raspberry Pi Zero 2 W entre las placas que ejecutan firmware
([placas admitidas](https://docs.wokwi.com/diagram-format)). Por ello la Pi y
los módulos sin componente nativo se representan con
[chips personalizados](https://docs.wokwi.com/chips-api/chip-json). La OLED,
los pulsadores, las resistencias y el LED RGB usan componentes nativos.

Para trasladar el diagrama al editor web de Wokwi, crear los chips personalizados
con los nombres de los archivos `*.chip.json`, incorporar sus definiciones y
fuentes C, y copiar el contenido de `diagram.json`. Conservar juntos todos los
archivos del directorio. El editor representa los chips personalizados como
encapsulados genéricos con los terminales indicados; no como fotografías de los
módulos. En la Pi, `P11_GPIO17`, por ejemplo, significa pin físico 11, GPIO BCM 17.
La vista local muestra la cabecera física de dos columnas y 20 filas.

Este proyecto es un **diagrama de cableado**. Los chips C no implementan el
comportamiento de los dispositivos, y no se ha añadido firmware, Raspberry Pi OS
ni simulación de sensores. Las rutas `.chip.wasm` de `wokwi.toml` indican dónde
irían los binarios si se desarrollaran modelos funcionales; no se necesitan para
`lint` ni para la vista local. No ejecutar `wokwi-cli docs/wokwi` esperando
simular el programa Python de la manilla.

## Decisiones de montaje del PDF

- La distribución común de 3,3 V sale del pin físico 1; GND, del pin 6. Los
  pines de 5 V (2 y 4) quedan libres. En el SVG, las banderas 3,3 V y GND
  identifican estas mismas redes, evitando cables largos sobre las señales.
- OLED `0x3C`, ADS1115 `0x48` y MLX90614 `0x5A` comparten GPIO2/SDA y GPIO3/SCL.
  ADDR del ADS1115 va a GND; ALRT y A1–A3 quedan sin conectar. La salida A del
  SEN0564 va directamente a A0.
- Se representa el MLX90614 compatible con 3,3 V especificado en el documento.
- Subir, bajar y Enter cierran GPIO17, GPIO27 y GPIO22 a GND. Las resistencias
  pull-up son internas y no se dibujan resistencias externas.
- El INMP441 usa GPIO18/SCK, GPIO19/WS y GPIO20/SD. L/R va a GND. GPIO16 y
  GPIO21 quedan reservados y sin cables.
- El buzzer usa VCC, GND e I/O en GPIO24. Su polaridad de activación depende
  del módulo, según la nota del PDF.
- El LED RGB es de cátodo común, con 220 Ω en rojo y 100 Ω en verde y azul.
  Se muestra la variante con resistencias externas: omitirlas si la placa ya
  las incorpora. Una variante de ánodo común exige cambiar COM a 3,3 V e invertir
  la activación, como indica el PDF.
- El motor se controla desde GPIO23 mediante 1 kΩ a la base del NPN. La base
  tiene 10 kΩ a GND; el emisor va a GND y el colector al negativo del motor.
  El diodo y el condensador de 100 nF están en paralelo con el motor: cátodo K
  a 3,3 V y ánodo A al colector. Identificar B/C/E en el transistor real.
- La Raspberry Pi 4 se muestra como central de red, con alimentación propia y
  sin conexiones GPIO a la Zero 2 W.

## Regenerar

```sh
python3 docs/wokwi/generar.py
wokwi-cli lint --warnings-as-errors docs/wokwi
node docs/wokwi/exportar.cjs
```

`generar.py` usa solo Python estándar y sobrescribe `diagram.json`, las
definiciones de chips y `wokwi.toml`; después llama a `ilustrar.py` para generar
SVG y HTML con los componentes dibujados. Para cambios permanentes de
cableado, editar las conexiones de ese script. `exportar.cjs` usa Playwright
instalado en `web-app/node_modules` y Chromium para actualizar PNG/PDF.
La vista HTML y el SVG ya generados funcionan sin instalar dependencias.

Para actualizar únicamente la ilustración sin sobrescribir el cableado Wokwi:

```sh
python3 docs/wokwi/ilustrar.py
node docs/wokwi/exportar.cjs
```
