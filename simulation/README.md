# Gemelo digital minero (simulation/)

Simulador 3D y gemelo digital de una mina subterránea **ficticia** inspirada en operaciones de Bolivia. Se controla a un minero que lleva la manilla del proyecto (`esp32-device/`, ESP32-S3) y la manilla mide y transmite según el lugar de la mina donde está. Más adelante se integrará con la central de Mining System (`backend/`, rama `develop`).

> Prototipo de monitoreo y apoyo visual. No sustituye equipos certificados, protocolos de seguridad minera ni sistemas oficiales de emergencia. Las representaciones de gases son visualizaciones de datos o escenarios didácticos, no predicciones físicas.

## Estado

- **Fase 0** (auditoría, investigación y plan): completada.
- **Fase 1** (fundación gráfica): implementada y probada.
- **Fase 2A** (minero controlable y manilla simulada, pedida el 2026-11-23): implementada y probada. Detalle en [PROGRESS.md](PROGRESS.md).

Hoy el gemelo tiene:

- una **galería de validación** de unos 200 m: tramos entibados, en roca desnuda, con arcos de acero y con concreto lanzado, un cruce, una zona de carguío, un frente ciego y un refugio;
- un **minero** con equipo de protección que se controla con WASD, choca con la roca y se ve en tercera o primera persona;
- su **manilla ESP32-S3 simulada**, con la misma lógica que el firmware: pantalla OLED con el menú real, LED, buzzer y motor, umbrales con confirmación e histéresis, alarmas automáticas y tramas de telemetría cada 2 s;
- un **ambiente simulado** que depende de la ubicación: aire fresco en la bocamina, escape diésel en la zona de carguío y humos de voladura en el frente que se disipan con el tiempo;
- una **central simulada** local que responde a la manilla y le envía avisos;
- vista de supervisión con corte de bóveda, 4 perfiles gráficos y diagnóstico de render.

Todos los datos son simulados y así se rotulan. **No hay conexión con la central real**: los navegadores no pueden enviar la cabecera `X-Device-Key` que exige `/ws/device` (ver ARCHITECTURE.md, ADR-013).

## Requisitos

Node.js 22.12 o superior (probado con 25.9) y npm. Una GPU dedicada es recomendable para los perfiles Alto y Ultra.

## Puesta en marcha

```sh
cd simulation
npm install
npm run assets:fetch      # descarga y verifica las texturas CC0 de Poly Haven (~140 MiB, una vez)
npm run dev               # http://localhost:5180
```

`assets:fetch` es idempotente: verifica MD5 y SHA-256 y no vuelve a descargar lo que ya está en `assets/cache/`. La aplicación no hace ninguna solicitud a orígenes externos en ejecución.

### Controles

| Modo | Controles |
| --- | --- |
| Supervisión | Arrastrar: orbitar · rueda: acercar · botón derecho: desplazar · «Corte de bóveda» muestra el interior · la etiqueta sigue al minero |
| Minero | Botón «Minero» y clic para capturar el ratón · **WASD: caminar** · Shift: correr · ratón: mirar · rueda: distancia de la cámara · **V: primera o tercera persona** · F: linterna del casco · Esc: liberar el ratón (pausa) |
| Manilla | **Mantener Q: mirar la manilla** · **↑ ↓ Enter: pulsadores subir, bajar y enter** (también con los botones del panel) |
| General | H: ocultar o mostrar paneles · selector de perfil Bajo/Medio/Alto/Ultra · «Supervisión» vuelve a la vista orbital |

El panel **Central simulada** permite cortar el enlace (la manilla encola y luego entrega), enviar avisos de la central (Evacuar ahora, Ir al refugio…) y alterar el escenario: nueva voladura en el frente, picos de gas o de calor como los comandos `simulate gas` y `simulate heat` de la consola del firmware, y el modo con el CO sin calibrar.

## Verificación

```sh
npm run typecheck
npm run lint
npm test                              # Vitest: generador, colisión, ambiente y manilla
npm run build
npx playwright test --project=e2e     # humo: render, errores de consola, sin solicitudes externas
npx playwright test --project=visual  # capturas en tests/output/screenshots/<perfil>/
npm run bench                         # recorrido fijo a 2560×1440 por perfil → tests/output/bench-*.json
```

Las pruebas de navegador compilan y sirven el build de producción en `http://127.0.0.1:5181` y usan Chromium con ANGLE/D3D11. `TWIN_QUALITIES=high` limita los perfiles y `TWIN_SOFTWARE_GL=1` fuerza WebGL por software (solo pruebas funcionales).

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `apps/twin-web/` | Aplicación React + React Three Fiber: escena, cámaras, interfaz y workers de generación. |
| `packages/shared-types/` | Tipos compartidos (configuración de la mina). |
| `packages/mine-generator/` | Generador determinista sin dependencias de render: SDF de galerías, Surface Nets, luz horneada e infraestructura. |
| `packages/graphics-engine/` | Materiales PBR (roca triplanar, iluminación de luminarias), geometrías, perfiles gráficos, caminante con colisión y diagnóstico. |
| `config/` | Configuración del escenario (`galeria-validacion.json`), separada del código de render. |
| `assets/` | Manifiesto de recursos y bloqueo con sumas de verificación; la caché de descargas no se versiona. |
| `scripts/` | Descarga de recursos, tabla de licencias e informe del generador. |
| `tests/` | Pruebas E2E, capturas y benchmark (Playwright). |

## Documentos

| Documento | Contenido |
| --- | --- |
| [PLAN.md](PLAN.md) | Auditoría, investigación, fases, tareas y criterios de aceptación. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Decisiones de arquitectura (ADR) y flujo de datos. |
| [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) | Procedencia y licencias de repositorios, recursos y dependencias. |
| [PROGRESS.md](PROGRESS.md) | Avance por fase con evidencia. |
| [TESTING.md](TESTING.md) | Estrategia de pruebas y resultados reales. |
