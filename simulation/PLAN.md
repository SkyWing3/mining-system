# PLAN — Gemelo digital minero (Mining IoT Digital Twin)

Estado: **Fase 0 completada. Fase 1 implementada y probada (2026-11-22); pendiente de revisión visual del usuario antes de la Fase 2.**
Rama base: **`develop`** (contiene `esp32-device/`, la central con MySQL y la web actual). `main` está desactualizada respecto del sistema en uso.

Este documento define qué se construirá, en qué orden, con qué dependencias y cómo se demostrará que cada parte funciona. Las decisiones de arquitectura con su justificación están en [ARCHITECTURE.md](ARCHITECTURE.md); la evaluación de licencias, en [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md); la evidencia de avance, en [PROGRESS.md](PROGRESS.md); la estrategia de pruebas, en [TESTING.md](TESTING.md).

> **Alcance y advertencia.** El gemelo digital es un prototipo de monitoreo y apoyo visual sobre una mina **ficticia** inspirada en operaciones subterráneas de Bolivia. No reproduce una operación real, no sustituye equipos certificados, protocolos de seguridad minera ni sistemas oficiales de emergencia, y sus representaciones de gases no son predicciones físicas de dispersión.

---

## 1. Auditoría del proyecto existente (Fase 0, revisada)

### 1.1 Hardware en uso: solo `esp32-device/`

Indicación del usuario (2026-11-22): **solo se usa lo que hay en `esp32-device/`**. No se usan el MQ-135, el ADS1115 ni la manilla en Python para Raspberry Pi (`device/`), aunque sigan en el repositorio.

| Elemento de la manilla ESP32-S3 DevKitC-1 | Función | Llega a la central |
| --- | --- | --- |
| SEN0564 (CO, ADC interno del ESP32-S3) | CO. Sensor **cualitativo**: informa ppm solo con calibración de dos puntos; sin ella informa tensión. Precalentamiento de 180 s. | `gasPpm` (calibrado) o `gasVoltage` (sin calibrar) |
| MLX90614 (I²C) | Temperatura ambiente y temperatura de objeto (infrarroja) | `temperatureC`, `objectTemperatureC` |
| INMP441 (I²S) | Mensajes de voz grabados en flash | `POST /api/device/voice` (WAV) |
| OLED SSD1306 + 3 pulsadores | Menú, reportes y lectura de avisos | Mensajes del catálogo, `notice-ack` |
| LED RGB, buzzer, micromotor | Aviso local al minero según umbrales propios | `level` y alarmas automáticas |
| Modo `sensors.simulated` | Lecturas sintéticas para demostraciones | `simulated: true` en cada lectura |

- Umbrales de la manilla (configurables por consola serie; valores por defecto): CO 35/200 ppm, ambiente 32/38 °C, objeto 60/90 °C, con histéresis y 3 muestras de confirmación. La manilla calcula el `level` (`normal`, `caution`, `danger`) y envía `CO_ALARM` / `HEAT_ALARM` con el valor medido.
- **Sin batería medida** (la web muestra «Sin sensor»), **sin posicionamiento** (la zona es un dato administrativo) y **sin MQTT**.
- El firmware compila y pasa 67 pruebas nativas, pero según su README **todavía no se probó en una placa**.

### 1.2 Central y web en `develop`

| Componente | Tecnología | Estado verificado en el código |
| --- | --- | --- |
| Central (`backend/`) | ASP.NET Core 10, EF Core 10 + **MySQL 8.4** con migraciones, SignalR tipado, cookies | API REST, `/ws/device` bidireccional, subida de voz por HTTP, avisos, presencia, historial de solo inserción protegido con triggers. |
| Web (`web-app/`) | React 19.2, TS 6.0, Vite 8.3, SignalR 10, IBM Plex Sans/Mono, lucide-react, oxlint, Playwright | Vista general, En vivo (curvas de 10 min), Mensajes, Alertas, Voz, Avisos, Manillas, Usuarios, Actividad. |
| Despliegue | Docker Compose (`mysql`, `backend`, `web-app` con Nginx) en Raspberry Pi 4B, `http://franco-rasp4.local` | Nginx del contenedor `web-app` sirve la SPA y redirige `/api`, `/hubs`, `/ws`. |

**Datos reales disponibles para el gemelo:**

- `TelemetryReceived { deviceId, reading }` por SignalR con cada lectura (cada 2 s por manilla): `temperatureC`, `objectTemperatureC`, `gasPpm`, `gasVoltage`, `level`, `simulated`, fecha. MySQL guarda una cada 10 s y cada cambio de nivel, minero o zona.
- `GET /api/devices` (presencia, zona, minero, última lectura incluida la viva) y `GET /api/devices/{id}/telemetry?since=&limit=` (hasta 1000 lecturas, con minero, manilla y zona del momento). **La consulta por fecha ya existe**: no hace falta ampliar el backend para el historial.
- Mensajes del menú (`HELP`, `OK`, `COLLAPSE`, `GAS`, `INJURY`, `EVACUATE`, `SUPPLIES`, `EXIT`) y alarmas automáticas (`CO_ALARM`, `HEAT_ALARM` con `detail`), revisión con `POST /api/messages/{id}/review`.
- Mensajes de voz (`VoiceMessageReceived`, `GET /api/voice/{id}/audio`) y avisos de la central a la manilla (`EVACUATE`, `SURFACE`, `SHELTER`, `HELP_COMING`, `RECEIVED`, `REPORT`) con estados `pending`, `delivered`, `read`, `expired`.
- Presencia: conectado si hubo un evento válido en los últimos 90 s.

### 1.3 Implicaciones para el gemelo

1. **Métricas reales posibles hoy:** CO (SEN0564), temperatura ambiente y temperatura de objeto (MLX90614). Sin calibración, el CO se muestra como tensión con calidad `uncalibrated` y **sin valor en ppm**.
2. **Solo simulación:** CO₂, CH₄, H₂S, O₂, humedad, material particulado, ruido y ventilación no tienen hardware. Estaciones fijas, carritos de monitoreo y robots de inspección son **entidades virtuales** del modo simulación.
3. **El nivel de una lectura real lo decide la manilla.** El gemelo muestra el `level` recibido y no lo recalcula con otros umbrales, para no contradecir la alarma que el minero ve en su muñeca. Los umbrales propios del gemelo se aplican a las métricas simuladas.
4. **`simulated: true` dentro del modo tiempo real** es un dato sintético de la manilla: se identifica como «simulado en la manilla» y nunca como medición real.
5. Las alertas reales más valiosas son `CO_ALARM`, `HEAT_ALARM` y los reportes críticos del minero; se ubican en la zona asignada a la manilla. Las grabaciones de voz y el estado de los avisos se muestran por trabajador.
6. Ubicación en 3D = **«asignada por zona»** mediante un archivo de correspondencias. Nunca se presenta como posición medida.
7. El gemelo se ejecuta en el navegador del **PC de la sala de control**, no en la Raspberry Pi: su rendimiento depende de la GPU de ese equipo (perfiles Bajo a Ultra).

### 1.4 Riesgos técnicos detectados

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| La regla `packages/` del `.gitignore` raíz ignora `simulation/packages/` (verificado con `git check-ignore` en `develop`). | Código no versionado. | Excepción `!/simulation/packages/` en F1.1. |
| La central exige MySQL. | Las pruebas de integración necesitan una base. | Contenedor `mysql:8.4` local (Docker 29 disponible) siguiendo `scripts/mysql_test_db.py`. |
| Orígenes autorizados y cookie `SameSite=Strict`. | El gemelo en otro puerto no podría autenticarse. | Desarrollo: proxy Vite + `Mining__AllowedOrigins__N=http://localhost:5180`. Producción: misma Nginx en `/twin/` (cambio aditivo en F6.4). |
| Firmware ESP32 no validado en placa. | No hay lecturas reales para validar. | Adaptador probado contra la central real alimentada por un cliente de prueba identificado como tal; validación física pendiente y declarada. |
| drei `useGLTF` usa por defecto un decodificador Draco en CDN. | Dependencia de CDN en ejecución. | Decodificadores locales y prueba Playwright que falla ante solicitudes externas. |
| Recursos 3D pesados en la imagen Docker de la Raspberry Pi. | Imagen grande, despliegue lento. | Presupuesto de tamaño, KTX2/meshopt, perfiles de textura; medir en F8. |

---

## 2. Investigación de repositorios y recursos (resumen)

Verificación realizada el 2026-11-22. Detalle en [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).

| Recurso | Licencia | Decisión |
| --- | --- | --- |
| ruixi892-beep/smart-mine-digital-twin | **Sin licencia** | Descartado para código; referencia conceptual. |
| LTU-RAI/PERSEPHONE-WORLDS | **Sin licencia**; texturas de pngtree | Descartado. |
| LTU-RAI/darpa_subt_worlds | MIT, con teselas de otra procedencia | Descartado por ahora. |
| Rodneymondela/ventilation-simulator | MIT | Reutilizable (opcional, F4.6). |
| vibe-stack/super-terrain | MIT, solo WebGPU | Solo ideas. |
| VictorZakharov/cape-physics | MIT | Reutilización parcial de técnicas. |
| majidmanzarpour/threejs-procedural-dungeon | MIT | Reutilizable: RNG y disposición de galerías. |
| MatinShahin/digital-oil-field | MIT | Solo ideas (vista de corte). |
| WayneChou-bot/WareTwin | MIT | Referencia principal de arquitectura. |
| game4automation/realvirtual-WEB | **AGPL-3.0** | Descartado para código. |
| SamG-Coder/RealFireThreeJS | MIT, solo WebGPU | Opcional, baja prioridad. |
| bandinopla/threejs-fluid-simulation | MIT | Opcional, baja prioridad. |
| 3dassets.dev — Underground Mine and Shaft Works | CC0, generado por IA, sin texturas | Geometría base de maquinaria con materiales PBR propios. |
| Poly Haven / ambientCG | CC0 | Texturas PBR, HDRI y accesorios. |
| Quaternius | CC0 | Trabajadores (semirrealistas). |
| Kenney | CC0 | Sin uso (estilizado). |

---

## 3. Decisiones principales

Justificación completa en [ARCHITECTURE.md](ARCHITECTURE.md).

| ID | Decisión |
| --- | --- |
| ADR-001 | El gemelo vive en `simulation/` como monorepo npm independiente sobre `develop`. |
| ADR-002 | La central ASP.NET Core + MySQL existente es la única fuente real; sin FastAPI/PostgreSQL. MQTT queda como adaptador opcional sin hardware asociado. |
| ADR-003 | WebGL 2 + React Three Fiber; WebGPU se evalúa en F8 con medición. |
| ADR-004 | Geometría procedural determinista desde configuración con semilla, pre-generada por fragmentos y cargada por zonas. |
| ADR-005 | Colisiones con `three-mesh-bvh`; Rapier solo ante una necesidad física real. |
| ADR-006 | Luz de luminarias horneada por vértice + reserva de luces dinámicas + linterna con sombra. |
| ADR-007 | Toda lectura lleva procedencia (`real`, `device-simulated`, `synthetic`, `replay`) y calidad obligatorias. |
| ADR-008 | Mapas de calor interpolados a lo largo de la red, con radio máximo y «sin medición» fuera de cobertura. |
| ADR-009 | Recursos descargados por script con manifiesto y SHA-256; sin CDN en ejecución. |
| ADR-010 | Umbrales del gemelo (métricas simuladas) con fuente citada y estado de revisión. |
| ADR-011 | Rutas de capacitación predefinidas, nunca calculadas. |
| ADR-012 | Para lecturas reales, el nivel de alerta es el que informa la manilla. |

---

## 4. Estructura objetivo

```text
simulation/
├── apps/twin-web/             # React + R3F (Vite, puerto 5180)
├── packages/                  # Consumidos como código TS
│   ├── shared-types/          # Tipos y esquemas: mina, sensores, lecturas, entidades
│   ├── mine-generator/        # Config → SDF/mallas por fragmento + grafo + anclajes
│   ├── graphics-engine/       # Materiales, post, perfiles, cámaras, LOD, diagnóstico
│   ├── simulation-engine/     # Reloj, agentes, escenarios, telemetría sintética
│   ├── navigation/            # Grafo, A*, seguimiento de rutas
│   ├── telemetry/             # Almacén, históricos, calidad
│   ├── iot-adapters/          # Simulado, Central (REST + SignalR), reproducción, MQTT (opcional)
│   └── alert-engine/          # Reglas, umbrales, pérdida de comunicación, reconocimiento
├── config/                    # mina, umbrales, ubicaciones, escenarios, rutas didácticas
├── assets/                    # manifest.json versionado; descargas en caché no versionadas
├── scripts/                   # fetch-assets, bake-mine, utilidades
├── tests/                     # E2E, benchmark, integración con la central
└── PLAN.md  PROGRESS.md  ARCHITECTURE.md  THIRD_PARTY_ASSETS.md  TESTING.md  README.md
```

### Stack (verificado en npm el 2026-11-22)

three 0.187 · @react-three/fiber 9.8 (React ≥19 <19.4) · drei 10.7 · postprocessing 6.39 (three <0.188) + @react-three/postprocessing 3.2 · n8ao 2.1 · three-mesh-bvh 0.9 · zustand 5.1 · Tailwind 4.3 · ECharts 6.1 · lucide-react · @microsoft/signalr 10 (igual que `web-app`) · zod 4 · simplex-noise 4 · idb 8 · sharp 0.35 · Vitest 5.1 · Playwright 1.64 · TypeScript 6.0 · Vite 8.3 · tipografía IBM Plex Sans/Mono local (la misma que `web-app`). Licencias en THIRD_PARTY_ASSETS.md §4.

KTX2 requiere `toktx` (KTX-Software, Apache-2.0), que no está instalado. Fase 1 usa JPEG redimensionado por perfil; la conversión a KTX2 se evalúa en F8 (instalar la herramienta requiere autorización).

---

## 5. Escenario minero ficticio

**«Mina Andina (escenario ficticio)»**: cerro andino con bocamina, castillo de pique y cinco niveles subterráneos (N0 socavón principal y N1–N4 cada 50 m). Terminología habitual en la minería boliviana. Objetivo: ≥ 5 km de galerías y 25 zonas.

| Zona | Nombre | Nivel |
| --- | --- | --- |
| Z01 | Patio de superficie y bocamina | Superficie |
| Z02 | Castillo de pique y casa de winche | Superficie |
| Z03 | Casa de ventilación principal | Superficie |
| Z04 | Taller de superficie y almacén | Superficie |
| Z05 | Sala de control y lamparería | Superficie |
| Z06 | Socavón principal (galería con rieles) | N0 |
| Z07 | Estación de pique N0 | N0 |
| Z08 | Taller de mantenimiento subterráneo | N0 |
| Z09 | Refugio N0 | N0 |
| Z10 | Galería principal N1 | N1 |
| Z11 | Tajeo / cámara de extracción N1-A | N1 |
| Z12 | Polvorín N1 | N1 |
| Z13 | Estación de monitoreo ambiental N1 | N1 |
| Z14 | Crucero y galerías N2 | N2 |
| Z15 | Tajeos N2 | N2 |
| Z16 | Buzones y zona de carguío | N2 |
| Z17 | Refugio N2 | N2 |
| Z18 | Galerías de exploración N3 | N3 |
| Z19 | Frente de avance N3 | N3 |
| Z20 | Chimenea de ventilación y escaleras | N1–N4 |
| Z21 | Estación de bombeo y sumidero | N4 |
| Z22 | Exploración profunda N4 | N4 |
| Z23 | Refugio N4 | N4 |
| Z24 | Rampa principal helicoidal | N0–N4 |
| Z25 | Pique principal (jaula) | Sup.–N4 |

Las zonas usan nombres compatibles con el campo `zone` de la central, de modo que una manilla registrada con «Galería principal N1» pueda ubicarse automáticamente (F6.3).

---

## 6. Fases, tareas y criterios de aceptación

Una tarea solo se marca completada en PROGRESS.md con **evidencia** (salida de pruebas, captura, medición) o con la declaración explícita de que no pudo validarse.

### FASE 0 — Auditoría e investigación ✅

### FASE 1 — Fundación gráfica

Al finalizar hay una **revisión visual con el usuario** antes de la Fase 2.

| ID | Tarea | Depende de |
| --- | --- | --- |
| F1.1 | Andamiaje: monorepo npm (workspaces), `apps/twin-web` (Vite 8, React 19.2, TS 6 estricto, Tailwind 4), paquetes, oxlint, Vitest, Playwright; excepción en `.gitignore`. | — |
| F1.2 | Pipeline de recursos: `assets/manifest.json` (fuente, autor, licencia, URL, SHA-256), `fetch-assets.mjs` (API de Poly Haven), variantes 1K/2K/4K con sharp. Rocas, suelo húmedo, metal pintado, óxido, madera de entibado, concreto lanzado, HDRI. | F1.1 |
| F1.3 | Núcleo gráfico: WebGL 2, sRGB, tone mapping AgX/ACES, perfiles **Bajo/Medio/Alto/Ultra**, posprocesado (N8AO, SMAA, bloom limitado, viñeta, corrección de color), niebla. | F1.1 |
| F1.4 | Material de roca PBR triplanar con variación macro, normal de detalle, humedad y suciedad. | F1.2, F1.3 |
| F1.5 | Generador v0 determinista: campo de distancia (SDF) de galerías con perfil de herradura + ruido en espacio mundial; mallado por fragmentos; malla de colisión. | F1.1 |
| F1.5b | **Spike de intersecciones:** SDF + mallado frente a extrusión de perfil para un cruce y una cámara; decidir con capturas, tiempos y triángulos. | F1.5 |
| F1.6 | Infraestructura instanciada: rieles de trocha angosta y durmientes, tuberías, ducto de ventilación, bandeja de cables, cuadros de madera, arcos de acero, luminarias, señalización en español. | F1.4, F1.5 |
| F1.7 | Iluminación: horneado por vértice, emisivos, reserva de luces dinámicas, linterna con sombra. | F1.5, F1.6 |
| F1.8 | Cámaras: `CameraRig` con transiciones; **orbital** y **primera persona** (WASD, mouse, Shift, velocidad configurable, ojos a 1,65 m, colisión de cápsula, linterna con F, Esc → supervisión). | F1.5 |
| F1.9 | Polvo en suspensión y animaciones ambientales. | F1.3 |
| F1.10 | Diagnóstico: FPS, tiempo por fotograma, draw calls, triángulos, objetos, geometrías/texturas, memoria de GPU estimada. | F1.3 |
| F1.11 | **Galería de validación** (~150 m): roca desnuda, entibado, arcos de acero, concreto lanzado, un cruce, una cámara, un refugio. | F1.4–F1.9 |
| F1.12 | Validación: capturas Playwright por punto de vista × perfil, benchmark de recorrido fijo, prueba de ausencia de solicitudes externas. | F1.10, F1.11 |

**Criterios de aceptación F1:** typecheck, lint, pruebas y build correctos; misma semilla → mismo hash de geometría; paredes irregulares con PBR, humedad y suciedad sin repetición evidente; recorrido en primera persona sin atravesar paredes; FPS medidos por perfil (objetivo ≥ 60 en Alto a 1440p en el equipo de desarrollo, RTX 4070 Ti; se informa el valor real); sin solicitudes externas; revisión visual del usuario.

### FASE 2 — Construcción de la mina

| ID | Tarea |
| --- | --- |
| F2.1 | Esquema de configuración (zod + JSON Schema): semilla, niveles, zonas, nodos, segmentos, perfiles, sostenimiento, piques, rampas, cámaras, reglas de infraestructura, anclajes. `mina-andina.mine.json`. |
| F2.2 | Generación: estructura principal desde el JSON + galerías de exploración procedurales (Delaunay + MST + bucles, adaptado de threejs-procedural-dungeon, MIT) → `bake-mine.mjs` produce fragmentos GLB + manifiesto de zonas. |
| F2.3 | Terreno andino procedural, materiales por pendiente/altura, HDRI, bocamina, instalaciones de superficie (pack CC0 con PBR propio), recortes en bocamina y collar. |
| F2.4 | Pique con jaula animada, rampa helicoidal, chimenea con escaleras, buzones. |
| F2.5 | Carga por zonas con liberación de recursos y LOD; vista orbital con LOD lejano. |
| F2.6 | Grafo de navegación y A*. |
| F2.7 | Vista de **corte transversal**: terreno transparente, planos de corte, aislamiento por nivel, rayos X. |

**Criterios F2:** 5 niveles conectados y ≥ 20 zonas; ≥ 5 km según el informe del generador; todas las zonas alcanzables; regeneración parcial; sin fugas en ciclos de carga; FPS registrados.

### FASE 3 — Maquinaria y trabajadores

| ID | Tarea |
| --- | --- |
| F3.1 | Trabajadores Quaternius (CC0) con casco con lámpara, chaleco y autorrescatador; vehículos del pack CC0 (LHD, jumbo, empernadora, locomotora, carros, transporte de personal, jaula) con PBR desgastado y luces. Brechas (camión de bajo perfil, excavadora): alternativa CC0, modelo paramétrico o Blender (D3). |
| F3.2 | `simulation-engine`: entidades, estados (en movimiento, detenido, trabajando, en espera, en mantenimiento, en zona de seguridad), reloj determinista, rutinas, seguimiento de rutas. |
| F3.3 | Render de agentes con LOD; pivotes animados. ≤ 50 agentes iniciales. |
| F3.4 | Cámara en **tercera persona**. |
| F3.5 | Estaciones fijas, carritos y robot de inspección **virtuales**, portadores de sensores simulados. |
| F3.6 | Selección por rayos, resaltado y etiquetas. |

**Criterios F3:** estados visibles y probados; trayectorias deterministas; 50 agentes medidos.

### FASE 4 — Sistema ambiental

| ID | Tarea |
| --- | --- |
| F4.1 | Modelo: sensor, dispositivo (manilla real, estación/carrito/robot virtual), catálogo de métricas. **Reales:** CO SEN0564 (ppm calibrado o tensión sin calibrar), temperatura ambiente y de objeto MLX90614, nivel de la manilla. **Solo simuladas:** CO₂, CH₄, H₂S, O₂, humedad, PM2.5/PM10, ruido, ventilación. |
| F4.2 | `telemetry`: almacén, históricos, calidad (vigente, desactualizada, inválida, mantenimiento, sin calibrar), actualización limitada de UI y gráficos. |
| F4.3 | Telemetría sintética reproducible por escenario (operación normal, falla de ventilación, CO tras voladura, bolsa de metano, caída de sensor, dato desactualizado). |
| F4.4 | Marcadores 3D, mapa de calor a lo largo de la red con «sin medición», capas volumétricas didácticas, leyendas. |
| F4.5 | `config/thresholds.json` para métricas simuladas, con fuente citada y `reviewed: false`. Las lecturas reales usan el `level` de la manilla (ADR-012). |
| F4.6 | (Opcional) Ventilación didáctica con el solucionador de ventilation-simulator (MIT). |

**Criterios F4:** transiciones de calidad probadas; ningún valor fuera de cobertura; el renderer no escribe lecturas (prueba de arquitectura).

### FASE 5 — Dashboard industrial

| ID | Tarea |
| --- | --- |
| F5.1 | Barra superior, panel izquierdo (niveles, zonas, sensores, trabajadores, vehículos, dispositivos, capas), panel derecho contextual, barra inferior (simulación, línea de tiempo, velocidad, cámara, navegación); modo inmersivo. |
| F5.2 | Tokens de diseño grafito; verde/ámbar/rojo solo para estados; IBM Plex local; contraste WCAG AA. |
| F5.3 | Gráficos ECharts con líneas de umbral. |
| F5.4 | Vista de **monitoreo** con enfoque automático de cámara. |
| F5.5 | Alertas: panel, notificaciones, historial, reconocimiento, registro; simuladas marcadas «SIMULACIÓN». |
| F5.6 | Configuración y modo de capacitación con rutas didácticas. |

**Criterios F5:** E2E de selección → panel → cámara; reconocimiento con autor y hora; capturas.

### FASE 6 — Integración IoT (central existente)

| ID | Tarea |
| --- | --- |
| F6.1 | `TelemetrySource` + `DataModeManager` (simulación, tiempo real, híbrido). |
| F6.2 | `CentralAdapter`: login (Admin/Supervisor), REST + SignalR. Correspondencias: `temperatureC` → temperatura ambiente, `objectTemperatureC` → temperatura de objeto, `gasPpm` → CO (ppm), `gasVoltage` → CO sin calibrar (tensión), `level` → nivel de la manilla, `simulated` → procedencia `device-simulated`. Batería: «sin sensor». Presencia con `online`; desconectado → última ubicación y lecturas desactualizadas. Historial con `?since=&limit=`. |
| F6.3 | Ubicación por `device-placements.json` o coincidencia exacta del campo `zone` con una zona del gemelo; sin correspondencia → «sin ubicación asignada». |
| F6.4 | Eventos reales en 3D: mensajes y alarmas (`CO_ALARM`, `HEAT_ALARM`) en la zona, revisión con la API existente; voz con reproducción; estado de avisos por manilla. Envío de avisos desde el gemelo solo como opción con confirmación (D6). |
| F6.5 | Servicio: desarrollo con proxy Vite; producción en la Nginx del contenedor `web-app` bajo `/twin/` (etapa de build y `location` adicionales; cambio aditivo, requiere aprobación). |
| F6.6 | Resiliencia: desconexión/reconexión con recarga, pérdida y desorden de mensajes, desfase de relojes, cargas inválidas. Integración con la central real y MySQL en contenedor, alimentada por un cliente WebSocket de prueba identificado como tal. |
| F6.7 | (Opcional) Adaptador MQTT con Mosquitto solo para pruebas: ningún hardware actual lo usa. |
| F6.8 | Lista de validación física con la manilla ESP32-S3; **pendiente** hasta probar el firmware en placa. |

**Criterios F6:** en tiempo real no aparecen lecturas al desconectar la fuente; los ocho estados de dispositivo y lectura se distinguen visualmente; las pruebas existentes de `backend`, `web-app` y `esp32-device` siguen pasando.

### FASE 7 — Historial y reproducción

F7.1 persistencia local (IndexedDB) separada por procedencia; F7.2 línea de tiempo con reproducción 0,5×–60× y salto a alertas, lecturas marcadas `replay`; F7.3 consultas por dispositivo, zona y rango, exportación CSV/JSON con procedencia y calidad. **Criterios:** reproducción idéntica a la grabación; exportación íntegra.

### FASE 8 — Optimización

Medir FPS, CPU/GPU, draw calls, triángulos, memoria, tamaño de recursos, latencia lectura → render, 500 sensores a 1 Hz y 50 agentes. Corregir cuellos de botella, resolución dinámica, KTX2/meshopt. Evaluar WebGPU con el mismo benchmark.

### FASE 9 — Auditoría final

Unitarias, integración, E2E, tsc, lint, build, `npm audit`, licencias, desconexión, integridad de datos, revisión visual y documentación.

---

## 7. Forma de trabajo

- Ciclo por fase: analizar → tareas y criterios → implementar → ejecutar → probar → corregir → documentar con resultados reales.
- Subagentes para pistas independientes y un **agente auditor** al cierre de cada fase.
- Sin commits, pushes ni cambios destructivos sin autorización.

## 8. Riesgos

| ID | Riesgo | Mitigación |
| --- | --- | --- |
| R1 | Realismo limitado por recursos CC0 (maquinaria generada por IA sin texturas; personajes semirrealistas). | PBR triplanar con desgaste; geometría de detalle; Blender opcional; declarar brechas. |
| R2 | Muchas luces en WebGL *forward*. | ADR-006. |
| R3 | Calidad de intersecciones. | Spike F1.5b. |
| R4 | Memoria con kilómetros de galerías. | Fragmentos, carga por zonas, LOD, liberación verificada. |
| R5 | Pocas métricas reales; CO sin calibrar; sin posicionamiento. | ADR-007/012; ninguna estimación como valor confirmado. |
| R6 | WebGL en Playwright. | Chromium con GPU en el equipo de desarrollo; SwiftShader solo para pruebas funcionales. |
| R7 | Umbrales sin respaldo normativo. | ADR-010. |
| R8 | Tamaño de recursos. | Descarga por script; presupuesto por perfil. |
| R9 | Firmware ESP32 sin validar en placa. | Pruebas con cliente identificado; validación física pendiente. |
| R10 | GPU desconocida en el PC de la sala de control. | Perfil Bajo y detección sugerida; medir en hardware modesto cuando esté disponible. |

## 9. Decisiones del usuario

| ID | Decisión | Estado |
| --- | --- | --- |
| D1 | Directorio `simulation/` | Por defecto |
| D2 | Recursos binarios no versionados; descarga verificada | Por defecto |
| D3 | Instalar Blender | Se pedirá en F3.1 si hace falta |
| D4 | Gemelo bajo `/twin/` en la Nginx de `web-app` | Por defecto; requiere aprobación en F6.5 |
| D5 | Adaptador MQTT | Opcional, sin hardware asociado |
| D6 | Enviar avisos a las manillas desde el gemelo | No por defecto (solo lectura del estado); se habilita si se aprueba |
| D7 | Hardware de referencia | **Solo `esp32-device/`** (confirmado por el usuario) |

## 10. Definición de terminado

Mina extensa y explorable con varios niveles; gráficos realistas; primera persona; vista global; selección de sensores, zonas y dispositivos; trabajadores y vehículos en 3D; telemetría en tiempo real; modo simulación sin hardware; datos reales y simulados diferenciados; mapas de calor e históricos; alertas; sin dependencias de pago; licencias compatibles; ejecución local; build de producción; pruebas; documentación. Cada criterio se cierra con evidencia en PROGRESS.md.
