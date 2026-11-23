# Gemelo digital minero (simulation/)

Simulador 3D y gemelo digital de una mina subterránea **ficticia** inspirada en operaciones de Bolivia. Se integra con la central de Mining System (`backend/`, rama `develop`) para visualizar el estado de las manillas ESP32-S3, sus mensajes y las condiciones ambientales.

> Prototipo de monitoreo y apoyo visual. No sustituye equipos certificados, protocolos de seguridad minera ni sistemas oficiales de emergencia. Las representaciones de gases son visualizaciones de datos o escenarios didácticos, no predicciones físicas.

## Estado

- **Fase 0** (auditoría, investigación y plan): completada.
- **Fase 1** (fundación gráfica): implementada y probada; pendiente de tu revisión visual antes de construir la mina completa. Detalle en [PROGRESS.md](PROGRESS.md).

La Fase 1 entrega una **galería de validación** de unos 200 m con:

- tramos entibados, en roca desnuda, con arcos de acero y con concreto lanzado;
- un cruce, una cámara de carguío, un frente ciego y un refugio;
- vista de supervisión con corte de bóveda;
- recorrido en primera persona con colisión y linterna;
- 4 perfiles gráficos y diagnóstico de render.

Todavía no consume telemetría.

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
| Supervisión | Arrastrar: orbitar · rueda: acercar · botón derecho: desplazar · «Corte de bóveda» muestra el interior |
| Primera persona | Clic para capturar el ratón · WASD o flechas: mover · Shift: correr · F: linterna · **Esc: volver a supervisión** |
| General | H: ocultar o mostrar paneles · selector de perfil Bajo/Medio/Alto/Ultra |

## Verificación

```sh
npm run typecheck
npm run lint
npm test                              # Vitest: generador y colisión
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
