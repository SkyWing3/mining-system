# TESTING — Gemelo digital minero

## Estrategia

| Nivel | Herramienta | Qué cubre | Estado |
| --- | --- | --- | --- |
| Unitarias | Vitest | Generador: determinismo, sección en herradura, gálibo, piso caminable, costuras entre fragmentos, frente ciego, infraestructura. Caminante: colisión contra la galería generada. | **Implementadas (F1)** |
| E2E | Playwright (Chromium, ANGLE/D3D11, GPU real) | Render sin errores de consola, ausencia de solicitudes externas, cambio de modo de cámara, regeneración al cambiar el perfil. | **Implementadas (F1)** |
| Visual | Playwright | 9 capturas por perfil (supervisión y 8 puntos de vista programados). | **Implementadas (F1)**; revisión humana pendiente |
| Rendimiento | Playwright + diagnóstico interno | Recorrido fijo de 141 m a 1,6 m/s en primera persona con linterna, por perfil. Mide FPS, tiempo por fotograma, GPU, draw calls, triángulos, memoria y tirones. | **Implementado (F1)** |
| Componentes | Vitest + Testing Library | Indicadores de estado de dispositivos y lecturas | F4–F6 |
| Integración | Central real (MySQL en contenedor) + cliente de prueba | `CentralAdapter` | F6 |
| Resiliencia | Servidores simulados | Desconexión, pérdida y desorden de mensajes | F6 |
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
