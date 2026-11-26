# TESTING — Gemelo digital minero

## Estrategia

| Nivel | Herramienta | Qué cubre | Estado |
| --- | --- | --- | --- |
| Unitarias | Vitest | Generador: determinismo, sección en herradura, gálibo, piso caminable, costuras entre fragmentos, frente ciego, infraestructura. Caminante: colisión contra la galería generada. Ambiente por ubicación. Manilla: port de las pruebas del firmware e integración. | **Implementadas (F1, F2A)** |
| E2E | Playwright (Chromium, ANGLE sobre D3D11 o Metal, GPU real) | Render sin errores de consola, ausencia de solicitudes externas, cambio de modo de cámara, regeneración al cambiar el perfil. Minero con WASD y colisión, manilla, tramas y alarma en el frente. Cobertura Wi-Fi: cola sin señal, entrega al volver y falla de una antena. | **Implementadas (F1, F2A, F2B)** |
| Visual | Playwright | 9 capturas por perfil (supervisión y 8 puntos de vista programados). | **Implementadas (F1)**; revisión humana pendiente |
| Rendimiento | Playwright + diagnóstico interno | Recorrido fijo de 141 m a 1,6 m/s en primera persona con linterna, por perfil. Mide FPS, tiempo por fotograma, GPU, draw calls, triángulos, memoria y tirones. | **Implementado (F1)** |
| Componentes | Vitest + Testing Library | Indicadores de estado de dispositivos y lecturas | F4–F6 |
| Integración | Central real (MySQL en contenedor) + cliente de prueba | `CentralAdapter` | F6 |
| Resiliencia | Vitest + manilla virtual | Sin cobertura, señal débil (retransmisiones y cortes), cambio de antena, presencia en la central | **Implementadas (F2B)**; con la central real, F6 |
| Regresión del proyecto existente | `./scripts/test.sh` | Después de cualquier cambio en `backend/`, `scripts/` o la configuración raíz | La Fase 1 no modificó el proyecto existente, salvo una línea del `.gitignore` raíz |

Reglas:

- Se registran la salida real, la fecha y el equipo. Una prueba no ejecutada se declara como tal.
- Las mediciones de rendimiento indican resolución, perfil, navegador y GPU. No se afirma «60 FPS» sin medición.
- WebGL por software (SwiftShader) solo sirve para pruebas funcionales.

## Comandos

```sh
cd simulation
npm run typecheck && npm run lint && npm test && npm run build
npx playwright test --project=e2e
npx playwright test --project=visual          # TWIN_QUALITIES=high para un solo perfil
npm run bench                                 # con vsync (lo que ve un operador)
TWIN_UNCAPPED=1 npm run bench                 # sin vsync: margen máximo (ver nota)
TWIN_PROFILE=1 npx playwright test --project=bench tests/bench/profile.spec.ts   # perfil de CPU
node scripts/generator-report.mjs config/galeria-validacion.json 0.2 1          # informe del generador
```

## Resultados — Fase 2B, primera parte (2026-11-26)

Equipo: Apple M4 (CPU y GPU de 10 núcleos, Metal 4) con 16 GB, macOS, Node 26.8, Chromium 159 de Playwright 1.65 con ANGLE sobre Metal, ventana de 1600×900.

| Prueba | Resultado |
| --- | --- |
| `tsc -p tsconfig.json` | 0 errores |
| `oxlint` | 0 errores; los mismos 2 avisos intencionales (`useGallery.ts`, `useMaterials.ts`) |
| `vitest run` | **99 de 99 aprobadas** (11 archivos): 14 del generador, 2 del caminante, 18 del ambiente y la cobertura, y 65 de la manilla. Después del ajuste de la OLED: **106 de 106** (12 archivos, 7 nuevas de las fuentes U8g2) |
| `vite build` | Correcto; el bundle pesa 1,84 MB (598 kB gzip) |
| E2E | **4 de 4 aprobadas** (repetidas después del ajuste de la OLED y los pulsadores) |

Pruebas nuevas:

- **`packages/device-sim/test/wifi.test.ts`:**
  - la estación se asocia a la antena más fuerte y tarda en hacerlo; no se asocia bajo −85 dBm;
  - se queda con su antena y cambia solo tras 6 s sin balizas;
  - la pérdida de segmentos crece al debilitarse la señal;
  - sin señal, la `CO_ALARM` queda en la cola, las alertas locales siguen y la alarma llega al volver la cobertura con su `sentAt` original;
  - la central marca la manilla fuera de línea a los 90 s;
  - con −86 dBm las tramas llegan tarde y el enlace se corta y se rehace;
  - con buena señal se comporta como con cobertura total;
  - la voz espera la cobertura.
- **`packages/mine-environment/test/mine.test.ts`:**
  - niveles de cada cuarto de gas y de calor con los umbrales del firmware;
  - aire normal en galerías y refugios;
  - la zona no se confunde entre niveles;
  - buena señal en las galerías principales y sin señal en la labor abandonada;
  - la señal no atraviesa la roca entre niveles;
  - una esquina cuesta más que seguir recto;
  - una antena fuera de servicio deja un hueco.
- **`packages/mine-generator/test`:**
  - la consulta por celdas coincide con la búsqueda exhaustiva en más de 500 cajas;
  - la mina mide más de 1,8 km en dos niveles;
  - antenas y cadenas ubicadas; labores abandonadas sin luminarias; letreros de dirección con texto.
- **`tests/e2e/coverage.spec.ts`** (perfil Medio):
  - en la veta, señal buena con AP-06;
  - en el fondo de la labor abandonada: peligro, Wi-Fi desconectado, enlace caído, 1 mensaje en la cola y la central todavía con la manilla en línea;
  - de vuelta en la veta: cola vacía y `CO_ALARM` recibida con más de 5 s de espera, visible como «en cola» en el panel;
  - la falla de AP-06 desde el mapa deja sin señal el frente sin ventilación y al restablecerla se reconecta;
  - sin errores de consola.
- **`smoke.spec.ts` y `miner.spec.ts`:** adaptados a la mina simulada (frente Sur por `S13`). La regeneración al cambiar el perfil usa la galería de validación. `miner.spec.ts` prueba además que los pulsadores resaltan su botón y que Q con la rueda recorre el menú.
- **`packages/device-sim/test/u8g2.test.ts`:** fuentes reales de la OLED (ver PROGRESS.md, ajuste del 2026-11-26).
- **`coverage.spec.ts`** espera 6 s en la labor antes de volver: sin esa espera, si el Wi-Fi caía antes de la alarma, la entrega podía llegar en menos de 5 s y la prueba fallaba por tiempos, no por la simulación.

### Generación de la mina simulada (en la aplicación, 8 workers)

| Perfil | Hasta poder controlar al minero | Mina completa | Fragmentos | Triángulos de roca |
| --- | --- | --- | --- | --- |
| Medio | ~3,3 s desde abrir la página (55 fragmentos) | 8,2–10,4 s | 1 303 | 1 085 288 |
| Alto | — | 13,8 s | 1 303 | 1 726 788 |

En un hilo de Node, perfil Bajo: 552 fragmentos con superficie, 545 456 triángulos, 17,4 s (`scripts/generator-report.mjs`).

### Primera persona en la mina simulada (con vsync, 1600×900)

Medido con el diagnóstico interno tras 4 a 7 s en cada punto. El GPU informado por el *timer query* bajo Metal no es confiable (da más de 16 ms con 60 FPS), así que se registran FPS y p99.

| Punto | Medio antes del recorte | Medio | Alto |
| --- | --- | --- | --- |
| Galería con arcos (S03) | 60 FPS · 3,20 M triángulos | 60,1 FPS · p99 19,1 ms · 168 draw calls · 0,54 M | 59,8 FPS · 0,59 M |
| Rampa (S14) | 60 FPS · 2,36 M | 59,8 FPS · 0,30 M | 56,5 FPS · 0,36 M |
| Zona de carguío N0 | 45,1 FPS · 3,35 M | 56,6 FPS · 0,58 M | **38,8 FPS** · 0,66 M |
| Incendio latente (humo) | 60 FPS · 1,59 M | 60,2 FPS · 0,11 M | 60,1 FPS · 0,14 M |
| Labor caliente (con luminarias y vapor) | 50,9 FPS · 3,11 M (sin luminarias) | 60,0 FPS · p99 18,4 ms · 0,40 M | **40,2 FPS** · 0,43 M |

En Alto, las caídas en las cámaras amplias se deben al relleno de píxeles (oclusión ambiental media, DPR 1,5 y sombra de 2048), no a la geometría: siguen con el recorte activo y con menos de 0,7 M de triángulos.

## Resultados — Fase 2A (2026-11-23)

El equipo y el navegador son los mismos que en la Fase 1.

| Prueba | Resultado |
| --- | --- |
| `tsc -p tsconfig.json` | 0 errores |
| `oxlint` | 0 errores; los mismos 2 avisos intencionales de la Fase 1 |
| `vitest run` | **76 de 76 aprobadas** (9 archivos): 11 del generador, 2 del caminante, 7 del ambiente y 56 de la manilla |
| `vite build` | Correcto; el bundle pesa 1,79 MB (583 kB gzip) |
| E2E | **3 de 3 aprobadas** |

Pruebas nuevas:

- **`packages/device-sim/test`:**
  - casos portados de `test_alerts`, `test_interface` y `test_link`, y de `test_app` y `test_sensors` (un caso adaptado a la cola de voz en memoria): confirmación e histéresis, prioridades del LED, silencio y reanudación, pitido de precaución, navegación y textos de la OLED, avisos y alarma en pantalla, tramas de telemetría exactas y sus límites, calibración, alarma automática una vez por transición y rearmado, heartbeat, `ack`, identidad, entrega y cola sin enlace;
  - integración de `VirtualBracelet`: aire limpio da nivel normal, LED verde y telemetría cada 2 s; 260 ppm da peligro tras 3 muestras, LED rojo intermitente, buzzer 400/400 ms y `CO_ALARM` confirmada; misma semilla, mismo registro; sin central se encola y se entrega al reconectar; avisos con confirmación `delivered` y `read`; voz simulada; CO sin calibrar.
- **`packages/mine-environment/test`:** bocamina limpia y fría; calentamiento del aire; frente en peligro al inicio y disipación a los 40 min; nueva voladura; propagación por las galerías (no a través de la roca); superficies más calientes que el aire; determinismo.
- **`tests/e2e/miner.spec.ts`** (perfil Medio):
  - botón «Minero» → tercera persona;
  - W durante 3 s → avanza más de 2,5 m;
  - A durante 3 s contra el hastial → no lo atraviesa;
  - enlace conectado y telemetría con `"simulated": true`;
  - nivel normal en la bocamina;
  - ↓ y Enter cambian la OLED;
  - en el frente F1, nivel peligro, `CO_ALARM` enviada y zona «Frente de avance»;
  - sin errores de consola;
  - capturas en `tests/output/screenshots/miner/`.

No ejecutado en esta fase: el benchmark en tercera persona. Las cifras de diagnóstico anotadas en PROGRESS.md salen de las capturas, no de una medición controlada.

## Resultados — Fase 1 (2026-11-22)

**Equipo:** Windows 11 Pro, i9-12900K (24 hilos), 15,7 GB de RAM, NVIDIA GeForce RTX 4070 Ti. Node 25.9.0. Chromium de Playwright 1.65.1 con ANGLE/Direct3D 11 (el renderer informado es `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti … Direct3D11 …)`).

### Calidad de código

| Prueba | Resultado |
| --- | --- |
| `tsc -p tsconfig.json` | 0 errores |
| `oxlint` | 0 errores. 2 avisos `react(set-state-in-effect)`, intencionales: `useGallery.ts` reinicia los fragmentos y `useMaterials.ts` retira los materiales al cambiar de perfil. |
| `vitest run` | **13 de 13 aprobadas** (2 archivos, ~18 s) |
| `vite build` | Correcto. El bundle principal pesa 1,70 MB (550 kB gzip) y supera el límite de aviso; la división en partes queda para F8. |

Pruebas unitarias (Vitest):

- `generator.test.ts`:
  - la sección es negativa dentro y positiva fuera;
  - bajo el arranque reconoce la clave cercana;
  - es continua en el arranque;
  - la misma semilla da el mismo hash y otra semilla da otro;
  - mallas sin NaN y con normales unitarias;
  - gálibo libre a 1,0 m y 2,0 m en todos los ejes;
  - piso del eje a menos de 6 cm de la cota;
  - soldadura exacta sin aristas abiertas con vóxeles de 0,2 y 0,35;
  - frente ciego respetado;
  - infraestructura acorde a la configuración.
- `walker.test.ts`:
  - recorre los 6 segmentos sin caer ni salir de la galería;
  - no atraviesa el hastial al caminar contra él durante 6 s.

### E2E (Playwright, build de producción)

| Prueba | Resultado |
| --- | --- |
| Genera, renderiza y no solicita recursos externos (perfil Medio) | Aprobada: 0 solicitudes externas y 0 errores de consola |
| Cambiar el perfil regenera la galería (Bajo → Alto, más del doble de triángulos) | Aprobada |

### Generador (un hilo, Node 25, sombras horneadas, galería de 203 m)

| Vóxel (perfil) | Fragmentos | Vértices | Triángulos | Tiempo | Hash |
| --- | --- | --- | --- | --- | --- |
| 0,35 m (Bajo) | 50 | 32 807 | 61 520 | 2,4 s | `03727f48` |
| 0,25 m (Medio) | 51 | 64 488 | 122 952 | 5,3 s | `9e4e18b8` |
| 0,20 m (Alto) | 51 | 101 924 | 196 420 | 9,0 s | `651ec051` |
| 0,16 m (Ultra) | 51 | 157 296 | 305 376 | 15,0 s | `62872351` |

Los hashes coinciden en dos corridas separadas (una de ellas con el benchmark ejecutándose a la vez).

### Benchmark de recorrido (con vsync, 2560×1440, DPR 1)

Archivo: `tests/output/bench-2026-11-22T213802.json` (no versionado; las cifras se copian aquí). Se descarta el primer segundo y hay unas 196 ventanas de 0,5 s por perfil.

| Perfil | Generación (8 workers) | FPS medio | FPS mín. (ventana) | Peor fotograma | Ventanas con fotogramas de más de 50 ms | GPU medio* | Draw calls máx. | Triángulos máx. | Memoria GPU estimada (parcial) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bajo | 1,14 s | 60,0 | 59,7 | 21,1 ms | 0 | 4,7 ms | 80 | 299 970 | 117 MB |
| Medio | 2,47 s | 60,0 | 59,5 | 20,0 ms | 0 | 6,6 ms | 141 | 627 195 | 471 MB |
| Alto | 2,39 s | 60,0 | 59,6 | 26,3 ms | 0 | 6,6 ms | 140 | 723 976 | 475 MB |
| Ultra | 3,61 s | 59,2 | **29,1** | 61,4 ms | **5** (avance 86–89 %) | 10,9 ms | 140 | 867 324 | 1 056 MB |

\* Tiempo de GPU medido con `EXT_disjoint_timer_query_webgl2`. Con vsync la GPU baja su reloj, así que el valor sirve para comparar perfiles, no como margen exacto.

**Conclusiones:**

- El objetivo de **60 FPS estables se cumple en Bajo, Medio y Alto** a 1440p en este equipo.
- **Ultra no lo cumple**: al entrar en la cámara de carguío (avance 86–89 %, con 4 luminarias, texturas 4K y AO alto) hay fotogramas de hasta 61 ms y una ventana a 29 FPS. Queda como objetivo de la Fase 8.
- La memoria es una estimación parcial: incluye geometría y texturas de los materiales, pero no mapas de sombra, PMREM ni búferes de posprocesado.
- DPR 1: el `maxDpr` de 1,5–2 de Alto y Ultra no se probó, porque el navegador sin interfaz informa DPR 1.

### Investigación de tirones (registro)

1. **Primera corrida, sin vsync:** tirones de 100–190 ms (Alto) y de 250–730 ms (Ultra) en casi todas las ventanas, crecientes durante el recorrido.
2. **Primeras correcciones,** porque cambiar el número de luces o de planos de corte obligaba a recompilar los sombreadores:
   - precalentamiento (`compileAsync` e `initTexture`);
   - número constante de luces y de planos de corte;
   - sombra de la linterna solo con la linterna encendida.
3. **Perfil de CPU con CDP** (`profile.spec.ts`): el tiempo está en las llamadas `uniform*` de WebGL (render normal a más de 200 FPS) y no aparece ningún trabajo periódico de JavaScript. Diagnóstico: sin vsync, la cola de presentación de Chrome se satura y produce los tirones; no son de la aplicación.
4. **Con vsync, como lo usaría un operador:** 0 tirones de más de 50 ms en Bajo, Medio y Alto (tabla anterior).

Referencia sin vsync (antes de las correcciones de la auditoría): Bajo 1 554, Medio 392, Alto 265 y Ultra 109 FPS de media. Sirve como indicador de margen, no como medida de estabilidad.

### Capturas

`tests/output/screenshots/<perfil>/` (no versionadas; se regeneran con `--project=visual`). Hay 9 por perfil:

- supervisión con corte de bóveda;
- socavón entibado;
- roca con rieles y servicios;
- cruce;
- arcos de acero;
- concreto lanzado;
- cámara de carguío;
- refugio;
- detalle de pared.

### No ejecutado

- `./scripts/test.sh` del proyecto existente: no se modificó el backend, la web ni la manilla. Solo se agregó la línea `!/simulation/packages/` al `.gitignore` raíz.
- Pruebas en hardware modesto (GPU integrada) ni en monitores de DPR mayor que 1.
- Prueba con usuarios de la navegación en primera persona: los controles se probaron por programa (puntos de vista y recorrido automático) y por la simulación del caminante. La captura del ratón real (pointer lock) no se puede automatizar en el navegador sin interfaz.
