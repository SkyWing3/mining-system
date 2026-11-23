# THIRD_PARTY_ASSETS — Procedencia y licencias

## 1. Recursos incorporados

Texturas PBR CC0 de Poly Haven declaradas en `assets/manifest.json` y descargadas con `npm run assets:fetch` (`scripts/fetch-assets.mjs`). La procedencia completa está en `assets/manifest.lock.json` (versionado): URL de cada archivo, MD5 publicado por Poly Haven, SHA-256, bytes, fecha de descarga y variantes producidas. Mapas usados: `Diffuse` (albedo), `nor_gl` (normal OpenGL) y `arm` (R = oclusión, G = rugosidad, B = metalicidad). Transformaciones: la resolución máxima se copia sin cambios; las menores, hasta 1k, se reducen con sharp (lanczos3, mozjpeg, calidad 90 en albedo y ARM, 95 en normal). Nunca se escala hacia arriba.

<!-- assets:start -->
_Tabla generada desde `assets/manifest.lock.json` con `node scripts/third-party-table.mjs`; no editar a mano._

| Textura | Rol | Autores | Licencia | Poly Haven | Resolución máx. |
| --- | --- | --- | --- | --- | --- |
| `quarry_wall_02` | `rock-wall` | Dimitrios Savva | CC0-1.0 | [Quarry Wall 02](https://polyhaven.com/a/quarry_wall_02) | 4k |
| `rock_face` | `rock-wall-oxidized` | Greg Zaal (fotografía), Dario Barresi (procesado) | CC0-1.0 | [Rock Face](https://polyhaven.com/a/rock_face) | 4k |
| `brown_mud_rocks_01` | `floor-wet` | Rob Tuytel | CC0-1.0 | [Brown Mud Rocks 01](https://polyhaven.com/a/brown_mud_rocks_01) | 4k |
| `rocky_trail` | `floor-dry` | Amal Kumar | CC0-1.0 | [Rocky Trail](https://polyhaven.com/a/rocky_trail) | 2k |
| `granular_concrete` | `shotcrete` | Dario Barresi (procesado), Michael Jenkins (fotografía) | CC0-1.0 | [Granular Concrete](https://polyhaven.com/a/granular_concrete) | 2k |
| `rough_wood` | `timber` | Rob Tuytel | CC0-1.0 | [Rough Wood](https://polyhaven.com/a/rough_wood) | 2k |
| `green_metal_rust` | `painted-metal` | Rob Tuytel | CC0-1.0 | [Green Metal Rust](https://polyhaven.com/a/green_metal_rust) | 2k |
| `rust_coarse_01` | `rusted-steel` | Dimitrios Savva (fotografía), Rico Cilliers (procesado) | CC0-1.0 | [Rust Coarse 01](https://polyhaven.com/a/rust_coarse_01) | 2k |
<!-- assets:end -->

`rocky_trail` (`floor-dry`) se descarga pero la Fase 1 no lo usa: está reservado para rampas y superficie (F2).

Las texturas se descargan una vez con `npm run assets:fetch`; en ejecución no se hacen solicitudes externas (verificado por `tests/e2e/smoke.spec.ts`). La tipografía IBM Plex (OFL-1.1) se sirve localmente con `@fontsource`.

### Código de terceros adaptado

Licencias verificadas con la API de GitHub el 2026-11-22.

| Origen | Licencia | Uso en el proyecto | Archivo |
| --- | --- | --- | --- |
| [three-mesh-bvh, ejemplo `characterMovement`](https://github.com/gkjohnson/three-mesh-bvh/blob/master/example/characterMovement.js), © 2018 Garrett Johnson | MIT (el aviso completo está en el archivo) | Paso de colisión de la cápsula contra la BVH y detección de piso | `packages/graphics-engine/src/walker.ts` |
| [Ben Golus, *Normal Mapping for a Triplanar Shader*](https://github.com/bgolus/Normal-Mapping-for-a-Triplanar-Shader) | Unlicense (dominio público) | Mezcla triplanar *whiteout* de normales | `packages/graphics-engine/src/materials/rockMaterial.ts` |
| mulberry32 (Tommy Ettinger) | Dominio público | Generador pseudoaleatorio por semilla (el mismo algoritmo que usa threejs-procedural-dungeon; no se copió código de ese repositorio) | `packages/mine-generator/src/rng.ts` |

No se copió código de los repositorios descartados (sin licencia o AGPL).

## 2. Evaluación de repositorios de referencia

Verificado el **2026-11-22** con la API de GitHub (campo `license`), la lectura de `LICENSE`/`README` y los árboles de archivos.

| Repositorio | Licencia verificada | Stack / tamaño | Valor técnico | Decisión |
| --- | --- | --- | --- | --- |
| [ruixi892-beep/smart-mine-digital-twin](https://github.com/ruixi892-beep/smart-mine-digital-twin) | **Ninguna** (sin archivo LICENSE) | HTML/JS + three + ECharts, 15 archivos | Concepto de vista superficie/subterráneo; la «simulación de desastres» no está validada | **Descartado** para código. Solo referencia conceptual, sin copiar. |
| [LTU-RAI/PERSEPHONE-WORLDS](https://github.com/LTU-RAI/PERSEPHONE-WORLDS) | **Ninguna**; contiene imágenes de pngtree (banco de imágenes comercial) | Mallas OBJ/STL y mundos Gazebo SDF, 302 MB | Escaneos de minas reales; derechos de texturas incompatibles | **Descartado.** |
| [LTU-RAI/darpa_subt_worlds](https://github.com/LTU-RAI/darpa_subt_worlds) | MIT declarada para el repositorio; incluye teselas de DARPA/Open Robotics de otra procedencia | Gazebo (CMake/SDF), 268 MB | Cuevas naturales, no infraestructura minera; formato Gazebo | **Descartado por ahora.** Reconsiderar solo con verificación de licencia por modelo. |
| [Rodneymondela/ventilation-simulator](https://github.com/Rodneymondela/ventilation-simulator) | MIT (© 2026 Rodney Mondela) | React 19, three 0.184, Zustand, Tailwind 4, Vitest | Solucionador Hardy Cross, resistencia de Atkinson, contaminantes, psicrometría, con pruebas | **Reutilizable (opcional, F4.6)** para ventilación didáctica. |
| [vibe-stack/super-terrain](https://github.com/vibe-stack/super-terrain) | MIT | R3F 9 + `WebGPURenderer`, **sin respaldo WebGL** | Terreno particionado, LOD, compilación en workers | **Solo ideas** (incompatible con la base WebGL 2). |
| [VictorZakharov/cape-physics](https://github.com/VictorZakharov/cape-physics) | MIT | three 0.185.1, TS 6, Vite 8, Bun | Cueva procedural con roca húmeda, sombras de antorcha, niebla, polvo; HUD de rendimiento | **Reutilización parcial** de técnicas de sombreado y diagnóstico. |
| [majidmanzarpour/threejs-procedural-dungeon](https://github.com/majidmanzarpour/threejs-procedural-dungeon) | MIT | three 0.185, Vite 8, un `main.js` de 2 268 líneas | RNG `mulberry32`, Delaunay + MST + bucles, BFS, instanciado | **Reutilizable:** algoritmos de disposición para galerías de exploración. |
| [MatinShahin/digital-oil-field](https://github.com/MatinShahin/digital-oil-field) | MIT | HTML + JS sin framework | Vista de rayos X del yacimiento | **Solo ideas** para la vista de corte. |
| [WayneChou-bot/WareTwin](https://github.com/WayneChou-bot/WareTwin) | MIT | R3F 8, drei 9, postprocessing, Zustand 5, three 0.169, React 18 + backend FastAPI | Simulación determinista, A*, paneles, servicio WS, esquema de estado | **Referencia principal de arquitectura**; se adaptará a R3F 9/React 19. |
| [game4automation/realvirtual-WEB](https://github.com/game4automation/realvirtual-WEB) | **AGPL-3.0** (edición comunitaria; módulos comerciales aparte) | three + TS, 238 MB | HMI industrial | **Descartado** para código: la AGPL obligaría a licenciar el gemelo bajo AGPL. |
| [SamG-Coder/RealFireThreeJS](https://github.com/SamG-Coder/RealFireThreeJS) | MIT | three WebGPU, WGSL | Fuego y humo volumétricos | **Opcional, baja prioridad** (solo WebGPU; escenarios didácticos). |
| [bandinopla/threejs-fluid-simulation](https://github.com/bandinopla/threejs-fluid-simulation) | MIT (port de WebGL-Fluid-Simulation, MIT) | three 0.177 | Fluido 2D en plano | **Opcional, baja prioridad**; riesgo de confundirse con dispersión física. |

## 3. Evaluación de fuentes de recursos 3D

| Fuente | Licencia verificada | Observaciones | Uso previsto |
| --- | --- | --- | --- |
| [3dassets.dev — Underground Mine and Shaft Works](https://3dassets.dev/packs/underground-mine-and-shaft-works) | CC0 1.0 (manifiesto JSON de la API) | 63 GLB, 5,8 MB, 133 178 triángulos en total; **0 texturas**; marcados como **generados por IA** en el manifiesto; métricos, +Y arriba; galerías en rejilla de 4 m, trocha de 750 mm, pivotes nombrados en maquinaria. | Geometría base de maquinaria (LHD, jumbo, empernadora, locomotora, carros, jaula, castillo, casa de winche, refugio, ventilación). Requiere materiales PBR propios; no se usará tal cual como resultado final. |
| [Poly Haven](https://polyhaven.com/license) | CC0 | API pública (`api.polyhaven.com`). Texturas: 125 en roca, 131 terreno, 25 metal, 138 madera. Modelos útiles: `industrial_caged_sconce`, `caged_hanging_light`, `mounted_fluorescent_lights`, `modular_industrial_pipes_01`, `modular_electric_cables`, `metal_toolbox`, `metal_tool_chest`, `metal_jerrycan`, `korean_fire_extinguisher_01`, `ladder_sectioned_01`, `old_gas_mask`. HDRI exteriores secos y montañosos. | Texturas PBR principales, HDRI, accesorios industriales. |
| [ambientCG](https://docs.ambientcg.com/license/) | CC0 1.0 | Materiales PBR (roca, tierra, metal pintado, óxido, concreto, madera). | Texturas PBR complementarias. |
| [Quaternius](https://quaternius.com/faq.html) | CC0 | Universal Base Characters y Universal Animation Library (1 y 2). | Trabajadores animados; estética semirrealista (limitación R1). |
| [Kenney](https://kenney.nl/support) | CC0 | Estilo low-poly/estilizado. | Sin uso previsto (no cumple el objetivo realista). |

## 4. Dependencias de software previstas

Versiones y licencias consultadas en el registro npm el 2026-11-22. Se instalarán en F1.1 y se auditarán en F9.

| Paquete | Licencia |
| --- | --- |
| three, @react-three/fiber, @react-three/drei, @react-three/postprocessing | MIT |
| postprocessing | Zlib |
| n8ao | ISC |
| three-mesh-bvh, three-custom-shader-material, camera-controls | MIT |
| zustand, zod, simplex-noise, tailwindcss | MIT |
| echarts | Apache-2.0 |
| lucide-react, idb | ISC |
| @microsoft/signalr | MIT |
| stats-gl, vitest, @gltf-transform/cli, meshoptimizer | MIT |
| sharp | Apache-2.0 |
| mqtt (opcional) | MIT |
| @fontsource-variable/inter / @fontsource/ibm-plex-sans | OFL-1.1 |
| KTX-Software `toktx` (herramienta de build) | Apache-2.0 |
