# Mining System

Central de operaciones para la manilla minera: ASP.NET Core 10, MySQL y React 19 + TypeScript y software Python para Raspberry Pi Zero 2 W. La Raspberry Pi 4 puede alojar la central. La interfaz utiliza blanco y la paleta `#DEC1AF`, `#491A06`, `#373946`, `#852A3B`, `#6C4B68`, en modo claro y sin gradientes.

La manilla lee el sensor de CO SEN0564 (mediante un ADS1115) y el termómetro infrarrojo MLX90614, muestra los valores en la OLED, avisa por LED RGB, buzzer y motor vibrador al superar sus umbrales, envía reportes predeterminados y mensajes de voz grabados con el INMP441, y recibe avisos de la central. Las lecturas llegan a la web **en tiempo real** por WebSocket.

## Ubuntu Server LTS con Docker

En la Raspberry Pi 4B con **Ubuntu Server LTS de 64 bits**, Docker y Docker Compose disponibles, ejecutar:

```sh
./start.sh
```

Si Docker requiere permisos de administrador, usar `sudo ./start.sh`. El script compila las imágenes, inicia la API y la web-app, espera sus comprobaciones de salud y muestra la dirección de acceso. Usar el mismo comando para actualizar tras cambiar el código.

Para detener la central conservando los datos: `./start.sh --down` (o `sudo ./start.sh --down`). `./start.sh --help` muestra las opciones.

Abrir **http://franco-rasp4.local**, usando el mDNS del servidor. Nginx redirige ambos WebSockets y la subida de voz; los datos, audios y sesiones se conservan en volúmenes. No hace falta crear `.env` ni instalar Node.js o .NET en el servidor.

Consultar [despliegue Docker](docs/docker.md) para configuración, actualizaciones, respaldos, mDNS y el contenedor opcional de la manilla.

## Desarrollo local

Requisitos: SDK .NET 10, Node.js 22.12+ (o 24+), npm y Python 3.10+ para el dispositivo y las pruebas.

Configurar primero MySQL según [docs/mysql.md](docs/mysql.md). Desde la raíz:

```sh
./scripts/dev.sh
```

Abrir **http://localhost:5173**. La API se ejecuta en **http://localhost:5080**. El primer acceso permite crear el administrador; no hay cuentas ni contraseñas predeterminadas. En accesos posteriores aparece el login. Ctrl+C detiene ambos servicios.

También se pueden iniciar por separado:

```sh
# Terminal 1
ASPNETCORE_ENVIRONMENT=Development dotnet run --project backend/backend.csproj --no-launch-profile

# Terminal 2
cd web-app
npm ci
npm run dev
```

Vite redirige `/api` y `/hubs` a la API para conservar las cookies en el mismo origen. Se puede cambiar el destino con `MINING_API_TARGET`. La configuración privada `launchSettings.json` del SDK puede contener puertos distintos; usar `--no-launch-profile`. Las migraciones se generan con la herramienta local: `dotnet tool restore && dotnet dotnet-ef migrations add Nombre --project backend/backend.csproj`.

## Flujo de uso

1. Crear el administrador desde la pantalla inicial.
2. En **Usuarios**, crear mineros y, si corresponde, supervisores. Las contraseñas tienen un mínimo de 10 caracteres.
3. En **Manillas**, registrar cada dispositivo, su zona y su minero. Cada minero puede tener una manilla activa. Guardar la credencial que se muestra una sola vez.
4. Copiar `device/config/settings.example.json` a `device/config/settings.json` y configurar la dirección de la central y esa credencial.
5. Iniciar el dispositivo o su simulador. Sus lecturas aparecen al instante en **En vivo**.
6. En la OLED, abrir **Mensajes**, seleccionar un reporte y confirmar **Enviar**, o abrir **Voz** para grabar un mensaje.
7. La central recibe el mensaje al instante en **Mensajes**, **Vista general** y, si es crítico, **Alertas**; las grabaciones aparecen en **Voz**.
8. Desde **Avisos** o desde la fila de una manilla se envía un aviso; su estado pasa de Pendiente a Entregado y Leído cuando el minero lo confirma con Enter.

| Rol | Permisos |
| --- | --- |
| Administrador | Monitoreo en vivo, mensajes, voz, avisos, revisión interna de alertas, manillas, gestión de usuarios, actividad y su cuenta. |
| Supervisor | Monitoreo en vivo, mensajes, voz, avisos, revisión interna de alertas, manillas, actividad y su cuenta. |
| Minero | Identidad del portador de la manilla; envía reportes y voz desde el dispositivo. No accede al panel de operaciones. |

Los reportes del menú son predeterminados: **Ayuda**, **Todo bien**, **Hay derrumbe**, **Presencia de gas**, **Compañero herido**, **Necesito evacuar**, **Necesito suministros** y **Saliendo de la mina**. La manilla envía además **Alarma de CO** y **Alarma de temperatura** cuando un sensor entra en peligro, con el valor medido. La web permite buscar (sin distinguir tildes), filtrar y exportar la página actual del historial. Marcar una alerta como revisada registra autor y fecha dentro de la central; no declara resuelto el incidente. Para comunicarse con el minero se usan los **avisos** predefinidos.

## Dispositivo y simulador

```sh
cd device
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n config/settings.example.json config/settings.json
# Editar settings.json: connection.url y connection.api_key
.venv/bin/python -m src.main --simulate --config config/settings.json
```

El simulador abre una ventana con la OLED, los botones (flechas y Enter), el LED, el buzzer y el motor. Sus sensores generan lecturas **marcadas como simuladas**; las teclas `g` y `t` fuerzan un pico de CO o de calor para probar las alarmas. La voz simulada es un tono sintético: no usa el micrófono del equipo.

Ejemplo de conexión en la manilla:

```json
{
  "connection": {
    "url": "ws://192.168.1.20:5080/ws/device",
    "api_key": "COPIAR_LA_CREDENCIAL_GENERADA_EN_LA_WEB",
    "heartbeat_seconds": 20,
    "telemetry_seconds": 2,
    "outbox_path": "../state/outbox",
    "voice_outbox_path": "../state/voice"
  }
}
```

Las secciones `sensors`, `alerts` y `voice` son opcionales; sus valores por defecto están en `settings.example.json` y se describen en [OLED, sensores y alertas](docs/hardware/oled-buttons.md). Las rutas de las colas se resuelven respecto al archivo JSON. La URL de subida de voz se deriva de `connection.url` (`ws://host/ws/device` → `http://host/api/device/voice`).

Sin credencial configurada, el menú muestra **Sin configurar** y no declara mensajes enviados. Con credencial, cada mensaje, alarma automática y confirmación de aviso se guarda primero en una cola local de archivos JSON con escritura atómica: **Guardado en cola**. Solo pasa a **Enviado a central** cuando recibe confirmación persistida por el servidor. Si no hay red, permanece en cola y se reintenta al reconectar, incluso después de reiniciar el proceso. El identificador estable evita duplicados. Las grabaciones usan una cola equivalente de archivos WAV.

En hardware:

```sh
GPIOZERO_PIN_FACTORY=lgpio .venv/bin/python -m src.main --config config/settings.json
```

Consultar [OLED, sensores y alertas](docs/hardware/oled-buttons.md), [lista de componentes](docs/componentes.tex), [cableado completo](docs/conexiones.tex) y [diagrama de cableado](docs/imagenes/cableado.png). Para conectar otra Raspberry Pi, servir la central en su interfaz de red: `MINING_BIND_URL=http://0.0.0.0:5080 ./scripts/serve.sh`.

## Aplicación compilada

```sh
./scripts/build.sh
./scripts/serve.sh
```

Abrir **http://localhost:5080**: el mismo proceso ASP.NET sirve React, API y ambos WebSockets. No se necesita Vite en producción. `MINING_BIND_URL` cambia la dirección de escucha. Los scripts conservan la base de datos en `data/`.

[Servicio systemd](infra/mining-system.service) y [ejemplo de proxy Nginx](infra/nginx.conf.example) están disponibles para la Raspberry Pi 4. El servicio presupone un usuario `mining`, una instalación en `/opt/mining-system` y .NET en `/usr/bin/dotnet`; adaptar estos valores a la instalación. Para HTTPS, colocar las rutas Nginx dentro del bloque del dominio y su certificado, y usar `wss://` en las manillas. Los encabezados de proxy se aceptan de los proxies locales conocidos por ASP.NET.

## Datos y configuración

- MySQL: usuarios, asignaciones, mensajes, lecturas (con minero, manilla y zona del momento), mensajes de voz, avisos y actividad. Esquema versionado con EF Core, claves foráneas, índices, restricciones `CHECK` y triggers que impiden borrar o alterar el historial. En Docker utiliza el volumen `mysql-data`.
- `data/keys/`: claves persistentes para las cookies; `data/voice/`: grabaciones. Conservar ambas junto a la base de datos al reiniciar o respaldar.
- `device/state/outbox/` y `device/state/voice/`: mensajes y grabaciones aún no confirmados. Datos y secretos quedan fuera de Git.
- `Mining__ConnectionString`: conexión a MySQL; admite contraseña separada mediante `Mining__PasswordFile`.
- `Mining__DataDirectory`: cambia la carpeta de claves de sesión, audios y configuración local del servidor. Fuera de los scripts, la carpeta predeterminada es `../data` respecto al directorio de contenido de ASP.NET.
- `Mining__AllowedOrigins__0`: origen adicional/autorizado para un frontend separado. En el despliegue integrado, el mismo origen funciona automáticamente.
- `Mining__Telemetry__PersistIntervalSeconds` (10): frecuencia de guardado de lecturas; además se guarda cada cambio de nivel, minero o zona. Todas se transmiten en vivo. El historial de lecturas es de solo inserción (ver [MySQL](docs/mysql.md#políticas-de-integridad)).
- `Mining__Voice__MaxBytes`, `Mining__Voice__MaxSeconds`, `Mining__Notices__ExpirationMinutes`, `Mining__PresenceWindowSeconds` y `Mining__LoginAttemptsPerMinute`: límites operativos; se validan al iniciar.
- Docker Compose carga `.env` automáticamente. Los scripts locales no: usar variables de entorno, User Secrets o `/etc/mining-system.env` con el servicio incluido.

Las sesiones usan cookies HttpOnly, SameSite Strict, expiración de ocho horas y contraseñas con hash. Las operaciones de la web requieren el encabezado `X-Mining-Client: web`. Los cambios de contraseña, rol, correo o estado invalidan las sesiones anteriores; las conexiones en vivo también se revocan. Las credenciales de manilla se guardan como hash y se validan en cada evento; renovar la credencial o deshabilitar la manilla cierra su socket en el momento.

## Verificación

```sh
./scripts/test.sh
```

El script compila la API y React, ejecuta las pruebas unitarias .NET, lint, pruebas del dispositivo, pruebas de integración contra MySQL y WebSockets reales, y pruebas de navegador con Playwright. Requiere MySQL y el cliente `mysql`; consultar [configuración y migración](docs/mysql.md). Utiliza bases de datos temporales y no crea usuarios de prueba en `data/`.

Pruebas por separado:

```sh
dotnet build backend/backend.csproj
dotnet test tests/backend.unit
(cd device && .venv/bin/python -m unittest discover -s tests -v)
device/.venv/bin/python -m unittest discover -s tests/backend -v
(cd web-app && npm run build && npm run lint && npm run test:e2e)
```

| Conjunto | Cobertura |
| --- | --- |
| `tests/backend.unit` (xUnit) | Validación WAV, política de guardado de telemetría, límites, catálogos, estados de avisos y jornada de Bolivia. |
| `device/tests` | Configuración y pines, controladores ADS1115/MLX90614, calibración de CO, umbrales con histéresis, LED/buzzer/motor, menú y OLED, colas durables, cliente WebSocket con avisos, grabación y subida de voz, orquestación. |
| `tests/backend` | API real con MySQL: roles, sesiones, asignaciones, idempotencia, telemetría en vivo y guardado limitado, alarmas automáticas, avisos de punta a punta, voz, revocación de sockets. |
| `web-app/tests` (Playwright) | Registro, panel, filtros, alertas, reconexión, lecturas en vivo sin recargar, gráficos, avisos, voz, cuenta y navegación móvil. |

Las pruebas de navegador generan capturas en `web-app/test-results/` (no versionadas).

## Alcance de sensores

La manilla muestrea cada `sensors.sample_seconds` (1 s) y transmite cada `connection.telemetry_seconds` (2 s). La central guarda y difunde temperatura ambiente y de objeto (MLX90614), CO del SEN0564 (en ppm solo con calibración; si no, su tensión) y el nivel de alerta. El circuito no incluye medición de batería: la web lo indica como **Sin sensor**.

El fabricante define el SEN0564 como sensor **cualitativo**. La manilla espera su precalentamiento (`warmup_seconds`) y solo informa ppm con una calibración de dos puntos (`python -m src.tools.calibrate_co`). Sin calibración no se alarma por CO. Los umbrales de precaución y peligro son configurables (por defecto CO 35/200 ppm, ambiente 32/38 °C, objeto 60/90 °C) y deben ajustarse a la normativa y al análisis de riesgos de cada operación; la manilla es un prototipo académico y no reemplaza un detector de gases certificado.

Hardware de la manilla: OLED SSD1306, tres botones, SEN0564 leído mediante un ADS1115, MLX90614, micrófono I²S INMP441, buzzer activo, LED RGB y micro motor vibrador. [Componentes](docs/componentes.tex) describe cada uno y [conexiones](docs/conexiones.tex) asigna sus pines y las pruebas por etapas. Todos los módulos se alimentan a 3,3 V. La configuración rechaza pines repetidos y los GPIO reservados para I²C (2, 3) e I²S (16, 18–21). La validación eléctrica, la calibración y la autonomía deben comprobarse con el montaje físico.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `backend/` | API ASP.NET Core en capas: `Domain`, `Data` (EF Core y migraciones), `DTOs`, `Services`, `Realtime` (SignalR y WebSocket de manillas), `Workers`, `Controllers`, `Middleware`, `Configuration`. |
| `web-app/` | Central React: `api`, `realtime`, `hooks`, `layout`, `pages`, `components`, `forms`, `styles` y pruebas de navegador. |
| `device/` | Manilla: `sensors`, `alerts`, `audio`, `communication`, `display`, `input`, `tools`, orquestación (`app.py`) y simulador. |
| `tests/` | Pruebas unitarias .NET, de integración de API/WebSockets y del despliegue Docker. |
| `docs/` | [Contrato de API y tiempo real](docs/api.md), hardware y documentación existente. |
| `scripts/` | Desarrollo, compilación, ejecución y pruebas. |
| `infra/` | Proxy Docker y plantillas de servicio para despliegue. |
| `compose.yaml` | Central Docker: MySQL, backend, web-app y almacenamiento persistente. |
| `compose.device.yaml` | Despliegue Docker opcional de la manilla (OLED, botones, sensores, alertas y micrófono). |
