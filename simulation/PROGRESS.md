# PROGRESS — Gemelo digital minero

| Fase | Estado | Evidencia |
| --- | --- | --- |
| F0 Auditoría e investigación | ✅ Completada (2026-11-22; revisada sobre `develop`) | Ver abajo |
| F1 Fundación gráfica | ✅ Implementada y probada (2026-11-22) | Ver abajo y TESTING.md |
| F2A Minero controlable y manilla simulada | ✅ Implementada y probada (2026-11-23), a pedido del usuario | Ver abajo y TESTING.md |
| F2B Construcción de la mina | 🟡 Primera parte implementada y probada (2026-11-26), a pedido del usuario: mina de 1,9 km en dos niveles, cuartos de gas y cobertura Wi-Fi | Ver abajo y TESTING.md |
| F3 Maquinaria y trabajadores | Pendiente | — |
| F4 Sistema ambiental | Pendiente | — |
| F5 Dashboard industrial | Pendiente | — |
| F6 Integración IoT | Pendiente | — |
| F7 Historial y reproducción | Pendiente | — |
| F8 Optimización | Pendiente | — |
| F9 Auditoría final | Pendiente | — |

---

## Fase 2B (primera parte) — 2026-11-26: mina ampliada, cuartos de gas y cobertura Wi-Fi

Pedido del usuario: «que la mina fuera mucho más grande, para que se pueda explorar de mejor manera», con «lugares de gases (como cuartos pero de mina) donde el sensor se ponga a prueba». También pidió que «en todo momento se monitoree la señal con la central, que no sea simplemente señal ilimitada»: cuando no hay señal, la manilla debe hacer lo que hace el firmware, con la cola de mensajes.

### Tareas

| ID | Estado | Evidencia y observaciones |
| --- | --- | --- |
| F2B.1 Mina ampliada | ✅ | `config/mina-simulada.json`: 1 915 m de ejes, 22 segmentos y 22 nodos en dos niveles. El nivel 0 tiene socavón entibado, galería principal con arcos y concreto lanzado, crucero al taller y al refugio, y la veta Norte con un circuito y labores. La rampa del 10 % (251 m, codo de 180°) baja 25 m al nivel −1, con su galería principal, zona de carguío, frente de avance, labor caliente, refugio y labor antigua. `scripts/layout-report.mjs` comprueba pendientes y que no haya cruces no previstos entre galerías. |
| F2B.2 Generación por cercanía | ✅ | Los workers reciben primero el fragmento pendiente más cercano al minero. Hay colisión por fragmento (`ChunkedCollider`) y se puede entrar en cuanto la zona inicial está lista. Perfil Medio en un M4: unos 3 s hasta poder controlar al minero y 8 a 10 s hasta la mina completa (1 303 fragmentos, 1,09 M de triángulos). ADR-014. |
| F2B.3 Rendimiento | ✅ | La roca y la infraestructura se recortan por distancia y por nivel. La infraestructura se instancia por celdas de 40 m y los tubos se parten en tramos. En primera persona, de 2,4–3,3 M de triángulos por fotograma se pasó a 0,1–0,6 M. `touchesBox` usa la rejilla del SDF. |
| F2B.4 Cuartos de gas y de calor | ✅ | Fuentes con recinto confinado (`plateau`: gas parejo dentro del cuarto) y humo o vapor visible:<ul><li>labor abandonada (CO 420 ppm, sin luz ni señal, cadena de prohibición);</li><li>frente sin ventilación auxiliar (precaución por CO y aire);</li><li>incendio latente (CO 950 ppm, calor y humo);</li><li>labor con agua termal (aire de unos 40 °C, superficies de unos 104 °C, vapor);</li><li>taller diésel, dos zonas de carguío y dos frentes de voladura.</li></ul>Letreros nuevos: peligro gases, prohibido el ingreso, alta temperatura y de dirección. |
| F2B.5 Cobertura Wi-Fi | ✅ | 12 antenas en el hastial con LED de estado. Propagación por las galerías con pérdida por distancia, curvatura, esquinas y tapones; la roca no deja pasar la señal. `scripts/coverage-report.mjs` muestra la señal por galería. ADR-015. |
| F2B.6 Manilla sin señal | ✅ | La estación Wi-Fi del ESP32 se asocia, se queda con su antena y se desasocia tras 6 s sin balizas. Hay retransmisiones TCP en orden, reintento del enlace cada 1 s sin Wi-Fi, cola durable con `sentAt` original, subida de voz que espera la cobertura y presencia de 90 s en la central simulada. |
| F2B.7 Interfaz | ✅ | Mapa (tecla M) con cobertura por galería, cuartos de gas, antenas (clic: falla o restablecimiento), refugios y flecha del minero; filtro por nivel. Panel de la central: Wi-Fi, enlace, presencia, cola y mensajes con su espera en la cola. Registro de tramas con los eventos de Wi-Fi y del enlace. Botones de voladura por frente. |

### Criterios de aceptación

| Criterio | Resultado |
| --- | --- |
| Mina bastante más grande y explorable | ✅ 1,9 km en dos niveles (antes 203 m), con mapa, letreros de dirección y 60 FPS en Medio (M4) |
| Cuartos donde se ponen a prueba los sensores | ✅ Pruebas de `mine.test.ts`: peligro por CO en la labor abandonada y en el incendio; precaución en el frente sin ventilación; peligro por temperatura del aire y de las superficies en la labor caliente; aire normal en galerías y refugios |
| Señal limitada con la central | ✅ `wifi.test.ts` y `coverage.spec.ts`: sin señal la `CO_ALARM` queda en la cola y llega al volver la cobertura con su hora original; con señal débil hay demoras y cortes; la central marca la manilla fuera de línea a los 90 s |
| Sin cambiar el comportamiento portado del firmware | ✅ Las 56 pruebas portadas pasan sin cambios: sin `network`, la cobertura es total |
| Typecheck, lint, pruebas y build | ✅ 0 errores; 99 de 99 pruebas unitarias y 4 de 4 E2E |

### Limitaciones

- El modelo de propagación es didáctico (ADR-015): los niveles de señal no sirven para diseñar una red real.
- La manilla no cambia de antena hasta perder la señal (así está el firmware), y al pasar entre dos antenas hay un corte breve. No se modificó el firmware.
- El humo y el vapor son niebla de color, no volúmenes iluminados por la linterna.
- En perfil Alto, la zona de carguío y la labor caliente bajan a unos 40 FPS en el M4: el límite es el relleno de píxeles (oclusión ambiental y DPR 1,5), no la geometría. `suggestQuality` propone Alto en equipos de más de 8 núcleos, y este M4 tiene 10.
- La mina completa sigue generándose en el navegador cada vez que se abre (sin caché). El benchmark y las capturas siguen usando la galería de validación.
- Todavía no hay superficie andina, pique ni maquinaria (resto de F2B y F3).

### Archivos

- **Nuevos:**
  - configuración: `config/mina-simulada.json`;
  - simulación: `packages/mine-environment/src/radio.ts`, `packages/device-sim/src/wifi.ts`;
  - gráficos: `packages/graphics-engine/src/collider.ts`, `culling.ts`;
  - aplicación: `apps/twin-web/src/layout.ts`, `ui/MineMap.tsx`, `ui/signal.ts`;
  - scripts: `scripts/layout-report.mjs`, `scripts/coverage-report.mjs`;
  - pruebas: `wifi.test.ts`, `mine.test.ts`, `tests/e2e/coverage.spec.ts`.
- **Modificados:**
  - generador: `field.ts` y `infrastructure.ts` (antenas, cadenas, cámaras sin luz, letreros con texto);
  - gráficos: `signs.ts`, `props.ts`, `propMaterials.ts`, `Infrastructure.tsx`, `RockChunks.tsx`, `walker.ts`;
  - simulación: `bracelet.ts` y `central.ts`; ambiente con recinto confinado, humo y vapor, y zona por nivel;
  - aplicación: `useGallery.ts`, `generator.worker.ts`, `runtime.ts`, paneles, HUD, escena y niebla;
  - pruebas y Playwright: Metal en macOS; las capturas y el benchmark usan `?layout=validacion`;
  - documentación.
- **Proyecto existente:** sin cambios.

---

## Fase 2A — 2026-11-23: minero controlable y manilla simulada

Pedido del usuario: «controlar a un minero dentro de la mina, es como un juego pero realista con las métricas de simulación reales», moverse con WASD con colisiones y ver la manilla «que simula el envío de datos basado en donde me encuentro». Se adelantó esta parte antes de construir la mina completa (F2B).

### Tareas

| ID | Estado | Evidencia y observaciones |
| --- | --- | --- |
| F2A.1 Minero | ✅ | Modelo procedural articulado: overol de alta visibilidad con cintas reflectivas, casco con lámpara, lentes, respirador con filtros, guantes de cuero, botas de goma, cinturón con batería de la lámpara y autorrescatador, y la manilla en la muñeca izquierda. Animación procedural de marcha, carrera, reposo, giro de cabeza y «mirar la manilla». Sin recursos externos. Capturas en `tests/output/screenshots/miner/`. |
| F2A.2 Control | ✅ | Tercera persona: WASD relativo a la cámara y el minero gira hacia donde camina. Primera persona: tecla V, vista desde los ojos del modelo. Misma cápsula contra BVH. E2E: avanza más de 2,5 m en 3 s y no atraviesa el hastial. |
| F2A.3 Cámara de tercera persona | ✅ | Detrás del hombro, rueda para la distancia, colisión por rayo contra la roca (se acerca de inmediato y se aleja con suavidad). Oculta al minero si la cámara queda pegada a él. |
| F2A.4 Port del firmware | ✅ | `packages/device-sim`, 22 módulos, escrito por un subagente y revisado: umbrales con confirmación e histéresis, alertas (LED, buzzer, motor, silencio), menú y renderizador de la OLED, catálogo de mensajes, cola durable en memoria, sesión del enlace, voz simulada sin audio, reloj sincronizado por `serverTime`. 56 pruebas, portadas de `esp32-device/test` y de integración. |
| F2A.5 Ambiente | ✅ | `packages/mine-environment`: distancia por las galerías (Dijkstra), calentamiento del aire desde la bocamina, fuentes con dilución y vida media, refugio con aire controlado. Escenario en `config/galeria-validacion.json`: humos de voladura en F1 (700 ppm al inicio, vida media de 7 min, hace 5 min) y escape diésel en la zona de carguío (42 ppm ± 30 %). 7 pruebas. |
| F2A.6 Central simulada | ✅ | Local: `ack` con `serverTime` e identidad, `messageId` para mensajes, avisos del catálogo del backend, corte y reconexión con espera creciente. Tramas con el formato de `docs/api.md` y `"simulated": true`. |
| F2A.7 Interfaz | ✅ | OLED ampliada y en la muñeca, pulsadores (botones y ↑ ↓ Enter), LED, buzzer con sonido (Web Audio, 2,7 kHz) y motor (temblor en primera persona). También: lecturas de la manilla frente al modelo, ubicación, registro de tramas, central simulada, controles del escenario y etiqueta del minero en supervisión. |

### Criterios de aceptación

| Criterio | Resultado |
| --- | --- |
| Mover al minero con WASD con colisiones | ✅ E2E (`tests/e2e/miner.spec.ts`) y `walker.test.ts` |
| La manilla mide según la ubicación | ✅ Bocamina: CO ~2 ppm, 11 °C, nivel normal. Frente F1 tras la voladura: CO > 200 ppm, nivel peligro, `CO_ALARM` enviada y confirmada (E2E). |
| Misma lógica que el firmware | ✅ 56 pruebas portadas o de integración; tramas idénticas en formato |
| Sin presentar datos simulados como reales | ✅ Rótulos «SIMULADO» en los paneles, `SIM` en la OLED (como el firmware con `sensors.simulated`), `"simulated": true` en cada trama y aviso «sin conexión a la central real» en la cabecera |
| Typecheck, lint, pruebas y build | ✅ 0 errores; 76 de 76 pruebas unitarias y 3 de 3 E2E |

### Limitaciones

- **No hay conexión con la central real.** El navegador no puede enviar `X-Device-Key` a `/ws/device`. Haría falta un relé local o un cambio en el backend; queda como decisión del usuario (ADR-013, D6).
- El modelo ambiental es didáctico (dilución exponencial por distancia), no un cálculo de ventilación.
- La fuente de la OLED aproxima la Helvetica de U8g2 con Arial a 1 bit: la disposición coincide, los píxeles no.
- El minero es procedural, de aspecto semirrealista. No tiene piel con *skinning* ni dedos articulados.
- Solo hay un minero. No colisiona con postes ni rieles, solo con la roca (igual que en F1).
- No se ejecutó el benchmark de recorrido en tercera persona. En las capturas de las pruebas (perfil Medio, 1600×900) el diagnóstico mostraba 60 FPS, una GPU de 4,5 a 8,7 ms y entre 62 y 131 draw calls.

### Archivos

- **Nuevos:**
  - `packages/device-sim/**` y `packages/mine-environment/**`;
  - `apps/twin-web/src/device/runtime.ts`, `apps/twin-web/src/scene/minerState.ts` y `apps/twin-web/src/ui/DevicePanels.tsx`;
  - `packages/graphics-engine/src/character/minerAvatar.ts`;
  - `tests/e2e/miner.spec.ts`.
- **Modificados:**
  - `CameraRig.tsx`, reescrito para el minero;
  - `Hud.tsx`, `store.ts`, `GalleryScene.tsx`, `useGallery.ts` y `main.tsx`;
  - `shared-types`, con el tipo del escenario ambiental;
  - `config/galeria-validacion.json`, con el bloque `environment`;
  - `apps/twin-web/package.json`;
  - documentación.
- **Proyecto existente:** sin cambios en esta fase.
- No se hicieron commits.

---

## Fase 1 — 2026-11-22

### Tareas

| ID | Estado | Evidencia y observaciones |
| --- | --- | --- |
| F1.1 Andamiaje | ✅ | Monorepo npm en `simulation/` con `apps/twin-web`, `packages/shared-types`, `mine-generator` y `graphics-engine`. Excepción `!/simulation/packages/` en el `.gitignore` raíz. Typecheck, lint, Vitest y Playwright operativos. |
| F1.2 Pipeline de recursos | ✅ (texturas) | Lo implementó un subagente y lo verifiqué: 8 texturas CC0 de Poly Haven con MD5 verificado y SHA-256 en `assets/manifest.lock.json`; variantes 1K/2K/4K; descarga idempotente y `--verify`. **No incluido:** HDRI (no hace falta bajo tierra; se agregará para la superficie en F2) ni KTX2 (falta `toktx`; se evaluará en F8). |
| F1.3 Núcleo gráfico | ✅ | WebGL 2, 4 perfiles, N8AO, bloom limitado a difusores HDR, AgX, corrección de color sobria, viñeta, SMAA y niebla. La corrección de color es paramétrica (`HueSaturation` y `BrightnessContrast`), no una LUT. |
| F1.4 Material de roca | ✅ | Triplanar *whiteout* con 4 capas (roca volada, roca oxidada, piso de barro, concreto lanzado), variación macro, humedad con charcos, suciedad baja y oclusión. Se corrigió un error de signo de la normal detectado en las capturas (hastiales negros). |
| F1.5 Generador | ✅ | SDF + Surface Nets por fragmentos, determinista. Pruebas de hash, gálibo, piso, costuras y frente ciego. |
| F1.5b Spike de intersecciones | ⚠️ Decidido sin comparación | Se eligió SDF. **No se implementó la alternativa de extrusión para medirla.** La justificación y la evidencia están en ARCHITECTURE.md, ADR-004. |
| F1.6 Infraestructura | ✅ | Instanciada: rieles de 750 mm y durmientes, tuberías de aire y agua con ménsulas, ducto flexible, cables con catenaria, cuadros de madera con encostillado, arcos de acero, pernos con placa, 7 letreros en español y refugio con tabique y puerta. |
| F1.7 Iluminación | ✅ | 25 luminarias horneadas con sombras suaves, especular dinámico de las más cercanas, linterna con sombra y entorno oscuro de mina para los reflejos (ADR-006 revisado). |
| F1.8 Cámaras | ✅ | Supervisión orbital (camera-controls) con corte de bóveda y primera persona: WASD, ratón, Shift, velocidad configurable, ojos a 1,65 m, cápsula contra BVH, F para la linterna, Esc vuelve a supervisión con transición. La tercera persona, la vista de corte completa y la vista de monitoreo están planificadas para F2, F3 y F5. |
| F1.9 Ambiente | ⚠️ Parcial | Hay polvo en suspensión ligado a la linterna. **Faltan animaciones ambientales** (ventilador, parpadeo, goteo): no hay todavía elementos animados en la galería. Se agregarán con el ventilador principal y la maquinaria (F2 y F3). |
| F1.10 Diagnóstico | ✅ | FPS, tiempo por fotograma (media y p99), GPU (timer query), draw calls, triángulos, objetos visibles, geometrías, texturas y memoria estimada (**parcial**, así rotulada). |
| F1.11 Galería de validación | ✅ | 203 m de ejes, 6 segmentos, 5 perfiles, cruce en T, cámara de carguío, frente ciego y refugio (`config/galeria-validacion.json`). |
| F1.12 Validación | ✅ | Capturas de 9 vistas en 4 perfiles; benchmark de recorrido en 4 perfiles; E2E sin solicitudes externas. Resultados en TESTING.md. |

### Criterios de aceptación de F1

| Criterio | Resultado |
| --- | --- |
| Typecheck, lint, pruebas y build | ✅ 0 errores; 13 de 13 pruebas unitarias y 2 de 2 E2E |
| Misma semilla → mismo hash | ✅ Prueba unitaria; además, el mismo hash en corridas independientes |
| Paredes irregulares con PBR, humedad y suciedad sin repetición evidente | ✅ en capturas; pendiente de tu juicio visual |
| Primera persona sin atravesar paredes | ✅ `walker.test.ts`. Los objetos (postes, rieles) todavía no colisionan. |
| ≥ 60 FPS estables en Alto a 1440p | ✅ 60 FPS, sin fotogramas de más de 50 ms (peor: 26 ms). **Ultra no lo cumple** (mín. 29 FPS en la cámara). |
| Sin solicitudes externas en ejecución | ✅ E2E |
| Revisión visual del usuario | ⏳ Pendiente |

### Auditoría independiente

Un subagente auditor revisó todo `simulation/` en modo solo lectura e informó 18 hallazgos confirmados y 5 posibles. Resolución:

- **Corregidos con prueba nueva:**
  - SDF de extremos ciegos (n.º 5);
  - bóveda bajo el arranque (n.º 8);
  - costuras entre fragmentos no idénticas bit a bit (n.º 13).
- **Corregidos:**
  - liberación de materiales en uso (n.º 1);
  - sombra de la linterna apagada (n.º 2);
  - variantes del precalentamiento (n.º 3);
  - memoria estimada sin la roca (n.º 4);
  - créditos MIT y Unlicense (n.º 6);
  - documentación contradictoria (n.º 7);
  - errores de workers (n.º 9);
  - primera persona durante la regeneración (n.º 10);
  - tabique del refugio (n.º 11);
  - inclinación de los postes (n.º 12);
  - `PCFSoftShadowMap` (n.º 14);
  - rejilla mínima y capa oxidada en Bajo (n.º 15);
  - `addAfterEffect` en el diagnóstico (n.º 16);
  - gancho de automatización solo en builds de prueba (n.º 17);
  - cifras de la documentación (n.º 18);
  - tipografía antes de los letreros (P1);
  - carrera en el E2E (P2);
  - colisionador ordenado (P3);
  - hash con todos los atributos (P4).
- **Pendientes:**
  - KTX2 y decodificación de texturas fuera del hilo principal (P5 → F8);
  - el determinismo está garantizado dentro de V8 (Node y Chromium), no entre motores JavaScript distintos (P4);
  - el especular de la roca no tiene visibilidad por luminaria (n.º 18 → F2).

### Archivos

- **Proyecto existente modificado:** `.gitignore` raíz, con una línea `!/simulation/packages/`.
- **Nuevo en `simulation/`:**
  - configuración: `package.json`, `tsconfig.json`, `.oxlintrc.json`, `.gitignore`, `vitest.config.ts`, `playwright.config.ts`;
  - código: `apps/twin-web/**`, `packages/shared-types/**`, `packages/mine-generator/**`, `packages/graphics-engine/**`;
  - datos y scripts: `config/galeria-validacion.json`, `assets/manifest.json`, `assets/manifest.lock.json`, `scripts/fetch-assets.mjs`, `scripts/third-party-table.mjs`, `scripts/generator-report.mjs`;
  - pruebas: `tests/**`;
  - documentación: actualizados todos los documentos.
- **Generados, no versionados:**
  - `assets/cache/` (140 MiB);
  - `apps/twin-web/public/content/textures/` (171 MiB);
  - `tests/output/`;
  - `node_modules/`.

### Otras acciones

- La copia de trabajo se cambió a la rama `develop` (`git checkout -b develop --track origin/develop`).
- No se hicieron commits ni pushes.

### Pendiente para la Fase 2

1. Tu revisión visual de las capturas o una prueba con `npm run dev`.
2. Configuración de la mina completa (5 niveles, 25 zonas, ≥ 5 km), pre-generación a GLB por fragmentos y carga por zonas.
3. Terreno andino, bocamina e instalaciones de superficie; pique, rampa y chimenea.
4. Grafo de navegación y vista de corte.
5. Rendimiento de Ultra en espacios amplios (cámara): F8, o antes si la mina completa lo agrava.

---

## Fase 0 — 2026-11-22

### Trabajo realizado

1. **Auditoría del repositorio,** primero sobre `main` (`57be712`) y después revisada sobre **`develop`** (`72c36d1`). El usuario indicó que `main` está desactualizada y que solo se usa el hardware de `esp32-device/`. Se leyeron:
   - `esp32-device/`: README, `platformio.ini`, configuración y `lib/core` (lecturas, sensores, niveles y trama de telemetría);
   - `backend/`: entidades, protocolo de dispositivo y Docker;
   - `docs/api.md`, `docs/mysql.md`, `compose.yaml`, `PRODUCT.md` y la configuración de `web-app`.

   Resultado en PLAN.md, sección 1.
2. **Entorno:** Node 25.9.0, npm 11.6.4, .NET SDK 10.0.402, Python 3.12.10, Docker 29.6.0 y Git LFS 3.7.1. No hay `gh` ni Blender. Equipo: RTX 4070 Ti, i9-12900K, 15,7 GB de RAM.
3. **Verificación de los 12 repositorios y de las fuentes de recursos** (licencias, manifiestos y catálogos). Resultado en THIRD_PARTY_ASSETS.md.
4. **Versiones y licencias npm del stack,** con compatibilidad de *peer dependencies*.
5. **Hallazgo:** la regla `packages/` del `.gitignore` raíz ignoraba `simulation/packages/`. Se corrigió en F1.1.
