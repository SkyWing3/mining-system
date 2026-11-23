# PROGRESS — Gemelo digital minero

| Fase | Estado | Evidencia |
| --- | --- | --- |
| F0 Auditoría e investigación | ✅ Completada (2026-11-22; revisada sobre `develop`) | Ver abajo |
| F1 Fundación gráfica | ✅ Implementada y probada (2026-11-22). **Pendiente de revisión visual del usuario** | Ver abajo y TESTING.md |
| F2 Construcción de la mina | Pendiente (comienza tras la revisión de F1) | — |
| F3 Maquinaria y trabajadores | Pendiente | — |
| F4 Sistema ambiental | Pendiente | — |
| F5 Dashboard industrial | Pendiente | — |
| F6 Integración IoT | Pendiente | — |
| F7 Historial y reproducción | Pendiente | — |
| F8 Optimización | Pendiente | — |
| F9 Auditoría final | Pendiente | — |

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
