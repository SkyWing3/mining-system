# Gemelo digital minero (simulation/)

Simulador 3D y gemelo digital de una mina subterránea **ficticia** inspirada en operaciones de Bolivia. Se controla a un minero que lleva la manilla del proyecto (`esp32-device/`, ESP32-S3) y la manilla mide y transmite según el lugar de la mina donde está. Más adelante se integrará con la central de Mining System (`backend/`, rama `develop`).

> Prototipo de monitoreo y apoyo visual. No sustituye equipos certificados, protocolos de seguridad minera ni sistemas oficiales de emergencia. Las representaciones de gases son visualizaciones de datos o escenarios didácticos, no predicciones físicas.

## Estado

- **Fase 0** (auditoría, investigación y plan): completada.
- **Fase 1** (fundación gráfica): implementada y probada.
- **Fase 2A** (minero controlable y manilla simulada, pedida el 2026-11-23): implementada y probada.
- **Fase 2B, primera parte** (mina ampliada, cuartos de gas y cobertura Wi-Fi, pedida el 2026-11-26): implementada y probada. Detalle en [PROGRESS.md](PROGRESS.md).

Hoy el gemelo tiene:

- una **mina simulada de 1,9 km en dos niveles** (`config/mina-simulada.json`): socavón, galería principal, veta Norte con un circuito, taller, zonas de carguío, frentes de avance, dos refugios y una rampa del 10 % con un codo de 180° que baja 25 m hasta el nivel −1. Se genera por zonas alrededor del minero: se puede entrar a los pocos segundos y el resto se completa mientras se recorre;
- **cuartos de gas y de calor** para poner a prueba los sensores: una labor abandonada con CO acumulado (peligro, sin luz y sin señal), un frente sin ventilación auxiliar (precaución por CO y por temperatura), un incendio latente con humo (peligro), una labor con agua termal (peligro por temperatura del aire y de las superficies, con vapor), el taller con motores diésel y los frentes de voladura;
- una **red Wi-Fi subterránea simulada** de 12 antenas: la señal recorre las galerías y no atraviesa la roca, se debilita con la distancia, las curvas y las esquinas, y hay zonas sin cobertura. La manilla se comporta como el firmware: sin señal encola los mensajes, reintenta y los entrega al volver la cobertura; con señal débil sufre retransmisiones y cortes. La central simulada muestra la última trama y marca la manilla fuera de línea a los 90 s, como la central real;
- un **mapa** con la cobertura por galería, los cuartos de gas, las antenas (con un clic se simula la falla de una) y la posición del minero;
- la **galería de validación** de unos 200 m de la Fase 1 (`?layout=validacion`), que siguen usando las capturas y el benchmark;
- un **minero** con equipo de protección que se controla con WASD, choca con la roca y se ve en tercera o primera persona;
- su **manilla ESP32-S3 simulada**, con la misma lógica que el firmware: pantalla OLED con el menú real y las mismas fuentes de U8g2 que la placa, LED, buzzer y motor, umbrales con confirmación e histéresis, alarmas automáticas y tramas de telemetría cada 2 s;
- un **ambiente simulado** que depende de la ubicación: aire fresco en la bocamina, recintos confinados con el gas parejo dentro del cuarto, escape diésel y humos de voladura que se disipan con el tiempo. El humo y el vapor se ven; el CO por sí solo no (como en una mina real);
- una **central simulada** local que responde a la manilla, le envía avisos y registra cuánto esperó cada mensaje en la cola;
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
| Manilla | **↑ ↓ Enter: pulsadores subir, bajar y enter** (también con los botones del panel) · **mantener Q: mirar la manilla**; con Q mantenida, la rueda recorre el menú y el clic elige |
| General | H: ocultar o mostrar paneles · **M: mapa** · selector de perfil Bajo/Medio/Alto/Ultra · «Supervisión» vuelve a la vista orbital |

El **mapa** muestra el nivel donde está el minero (o N0, N−1 o ambos), colorea las galerías según la señal Wi-Fi del modelo (buena, aceptable, débil, sin señal) y marca los cuartos de gas con su estado actual. Un clic en una antena la pone fuera de servicio (su LED se apaga en la escena) y otro la restablece.

El panel **Central simulada** muestra la señal Wi-Fi, el estado del enlace, si la central ve la manilla en línea, la cola de la manilla y los últimos mensajes recibidos («en vivo» o «N s en cola»). Permite cortar el enlace desde la central (la manilla encola y luego entrega), enviar avisos (Evacuar ahora, Ir al refugio…) y alterar el escenario: nueva voladura en cada frente, picos de gas o de calor como los comandos `simulate gas` y `simulate heat` de la consola del firmware, y el modo con el CO sin calibrar.

Para probar la cobertura: entrar a la galería de veta Norte, seguir por el acceso de la labor abandonada pasando la cadena y volver. En el fondo de la labor la manilla da peligro, pierde el Wi-Fi y guarda la `CO_ALARM`; al regresar a la veta se reconecta y la central la recibe con su hora original.

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

Las pruebas de navegador compilan y sirven el build de producción en `http://127.0.0.1:5181` y usan Chromium con ANGLE sobre D3D11 (Windows) o Metal (macOS). `TWIN_QUALITIES=high` limita los perfiles y `TWIN_SOFTWARE_GL=1` fuerza WebGL por software (solo pruebas funcionales). Las capturas y el benchmark usan la galería de validación para que sus cifras sigan siendo comparables con la Fase 1.

Para revisar una configuración de mina antes de abrirla:

```sh
node scripts/layout-report.mjs config/mina-simulada.json     # largos, pendientes y cruces no previstos
node scripts/coverage-report.mjs config/mina-simulada.json   # señal Wi-Fi a lo largo de cada galería
```

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `apps/twin-web/` | Aplicación React + React Three Fiber: escena, cámaras, interfaz y workers de generación. |
| `packages/shared-types/` | Tipos compartidos (configuración de la mina). |
| `packages/mine-generator/` | Generador determinista sin dependencias de render: SDF de galerías, Surface Nets, luz horneada e infraestructura. |
| `packages/graphics-engine/` | Materiales PBR (roca triplanar, iluminación de luminarias), geometrías, perfiles gráficos, caminante con colisión por fragmentos, recorte por distancia y diagnóstico. |
| `packages/mine-environment/` | Ambiente simulado (CO, temperatura, humo y vapor por ubicación) y cobertura Wi-Fi por las galerías. |
| `packages/device-sim/` | Port del firmware de la manilla, estación Wi-Fi del ESP32 y central simulada. |
| `config/` | Configuración de las minas (`mina-simulada.json`, `galeria-validacion.json`): galerías, ambiente, red Wi-Fi y letreros, separada del código de render. |
| `assets/` | Manifiesto de recursos y bloqueo con sumas de verificación; la caché de descargas no se versiona. |
| `scripts/` | Descarga de recursos, tabla de licencias e informes del generador, de la configuración y de la cobertura. |
| `tests/` | Pruebas E2E, capturas y benchmark (Playwright). |

## Documentos

| Documento | Contenido |
| --- | --- |
| [PLAN.md](PLAN.md) | Auditoría, investigación, fases, tareas y criterios de aceptación. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Decisiones de arquitectura (ADR) y flujo de datos. |
| [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) | Procedencia y licencias de repositorios, recursos y dependencias. |
| [PROGRESS.md](PROGRESS.md) | Avance por fase con evidencia. |
| [TESTING.md](TESTING.md) | Estrategia de pruebas y resultados reales. |
