# Mining System

Central de operaciones para la manilla minera: ASP.NET Core 10, React 19 + TypeScript y software Python para Raspberry Pi Zero 2 W. La Raspberry Pi 4 puede alojar la central. La interfaz utiliza blanco y la paleta `#DEC1AF`, `#491A06`, `#373946`, `#852A3B`, `#6C4B68`, en modo claro y sin gradientes.

## Ubuntu Server LTS con Docker

En la Raspberry Pi 4B con **Ubuntu Server LTS de 64 bits**, Docker y Docker Compose disponibles, ejecutar:

```sh
./start.sh
```

Si Docker requiere permisos de administrador, usar `sudo ./start.sh`. El script compila las imágenes, inicia la API y la web-app, espera sus comprobaciones de salud y muestra la dirección de acceso. Usar el mismo comando para actualizar tras cambiar el código.

Abrir **http://franco-rasp4.local**, usando el mDNS del servidor. Nginx redirige ambos WebSockets y los datos/sesiones se conservan en un volumen. No hace falta crear `.env` ni instalar Node.js o .NET en el servidor.

Consultar [despliegue Docker](docs/docker.md) para configuración, actualizaciones, respaldos, mDNS y el contenedor opcional de la manilla OLED.

## Desarrollo local

Requisitos: SDK .NET 10, Node.js 22.12+ (o 24+), npm y Python 3.10+ para el dispositivo y las pruebas.

Desde la raíz:

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

Vite redirige `/api` y `/hubs` a la API para conservar las cookies en el mismo origen. Se puede cambiar el destino con `MINING_API_TARGET`. La configuración privada `launchSettings.json` del SDK puede contener puertos distintos; usar `--no-launch-profile`.

## Flujo de uso

1. Crear el administrador desde la pantalla inicial.
2. En **Usuarios**, crear mineros y, si corresponde, supervisores. Las contraseñas tienen un mínimo de 10 caracteres.
3. En **Manillas**, registrar cada dispositivo, su zona y su minero. Cada minero puede tener una manilla activa. Guardar la credencial que se muestra una sola vez.
4. Copiar `device/config/settings.example.json` a `device/config/settings.json` y configurar la dirección de la central y esa credencial.
5. Iniciar el dispositivo o su simulador. En la OLED, abrir **Mensajes**, seleccionar un reporte y confirmar **Enviar**.
6. La central recibe el mensaje al instante en **Mensajes**, **Vista general** y, si es crítico, **Alertas**.

| Rol | Permisos |
| --- | --- |
| Administrador | Monitoreo, mensajes, revisión interna de alertas, manillas, gestión de usuarios, actividad y su cuenta. |
| Supervisor | Monitoreo, mensajes, revisión interna de alertas, manillas, actividad y su cuenta. |
| Minero | Identidad del portador de la manilla; envía reportes desde el dispositivo. No accede al panel de operaciones. |

Los reportes son predeterminados: **Ayuda**, **Todo bien**, **Hay derrumbe**, **Presencia de gas**, **Compañero herido**, **Necesito evacuar**, **Necesito suministros** y **Saliendo de la mina**. La web permite buscar, filtrar y exportar la página actual del historial. Marcar una alerta como revisada registra autor y fecha dentro de la central; no envía una respuesta a la manilla y no declara resuelto el incidente.

## Dispositivo y simulador

```sh
cd device
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n config/settings.example.json config/settings.json
# Editar settings.json: connection.url y connection.api_key
.venv/bin/python -m src.main --simulate --config config/settings.json
```

Ejemplo de conexión en la manilla, conservando los campos `display` y `buttons`:

```json
{
  "connection": {
    "url": "ws://192.168.1.20:5080/ws/device",
    "api_key": "COPIAR_LA_CREDENCIAL_GENERADA_EN_LA_WEB",
    "heartbeat_seconds": 20,
    "outbox_path": "../state/outbox.db"
  }
}
```

La ruta de la cola se resuelve respecto al archivo JSON. Sin credencial configurada, el menú muestra **Sin configurar** y no declara mensajes enviados. Con credencial, cada mensaje se guarda primero en SQLite local: **Guardado en cola**. Solo pasa a **Enviado a central** cuando recibe confirmación persistida por el servidor. Si no hay red, permanece en cola y se reintenta al reconectar, incluso después de reiniciar el proceso. El identificador estable evita mensajes duplicados.

En hardware:

```sh
GPIOZERO_PIN_FACTORY=lgpio .venv/bin/python -m src.main --config config/settings.json
```

Consultar [OLED y botones](docs/hardware/oled-buttons.md) y [cableado completo](docs/conexiones.tex). Para conectar otra Raspberry Pi, servir la central en su interfaz de red: `MINING_BIND_URL=http://0.0.0.0:5080 ./scripts/serve.sh`.

## Aplicación compilada

```sh
./scripts/build.sh
./scripts/serve.sh
```

Abrir **http://localhost:5080**: el mismo proceso ASP.NET sirve React, API y ambos WebSockets. No se necesita Vite en producción. `MINING_BIND_URL` cambia la dirección de escucha. Los scripts conservan la base de datos en `data/`.

[Servicio systemd](infra/mining-system.service) y [ejemplo de proxy Nginx](infra/nginx.conf.example) están disponibles para la Raspberry Pi 4. El servicio presupone un usuario `mining`, una instalación en `/opt/mining-system` y .NET en `/usr/bin/dotnet`; adaptar estos valores a la instalación. Para HTTPS, colocar las rutas Nginx dentro del bloque del dominio y su certificado, y usar `wss://` en las manillas. Los encabezados de proxy se aceptan de los proxies locales conocidos por ASP.NET.

## Datos y configuración

- `data/mining.db`: usuarios, asignaciones, mensajes, lecturas y actividad. SQLite con WAL, claves foráneas e índices.
- `data/keys/`: claves persistentes para las cookies; conservar junto a la base de datos al reiniciar o respaldar.
- `device/state/outbox.db`: mensajes aún no confirmados. Datos y secretos quedan fuera de Git.
- `Mining__DataDirectory`: cambia la carpeta del servidor. Fuera de los scripts, la carpeta predeterminada es `../data` respecto al directorio de contenido de ASP.NET.
- `Mining__AllowedOrigins__0`: origen adicional/autorizado para un frontend separado. En el despliegue integrado, el mismo origen funciona automáticamente.
- Docker Compose carga `.env` automáticamente. Los scripts locales no: usar variables de entorno, User Secrets o `/etc/mining-system.env` con el servicio incluido.

Las sesiones usan cookies HttpOnly, SameSite Strict, expiración de ocho horas y contraseñas con hash. Las operaciones de la web requieren el encabezado `X-Mining-Client: web`. Los cambios de contraseña, permisos o estado invalidan las sesiones anteriores; las conexiones en vivo también se revocan. Las credenciales de manilla se guardan como hash y se validan en cada evento.

## Verificación

```sh
./scripts/test.sh
```

El script compila la API y React, ejecuta lint, pruebas del dispositivo, pruebas de integración contra SQLite y WebSockets reales, y pruebas de navegador con Playwright. Utiliza bases de datos temporales y no crea usuarios de prueba en `data/`.

Pruebas por separado:

```sh
dotnet build backend/backend.csproj
(cd device && .venv/bin/python -m unittest discover -s tests -v)
device/.venv/bin/python -m unittest discover -s tests/backend -v
(cd web-app && npm run build && npm run lint && npm run test:e2e)
```

Las pruebas de navegador verifican creación del administrador, registro y edición de usuarios, manillas, llegada instantánea, lecturas, revisión de alertas, reconexión, cambio de contraseña y navegación móvil. Generan capturas en `web-app/test-results/` (no versionadas).

## Alcance de sensores

El servidor recibe, guarda y transmite temperatura, gas calibrado en ppm y batería. La web muestra la última lectura y su historial; no inventa datos ni aplica umbrales de riesgo sin calibración. `DeviceClient` admite un proveedor `telemetry` para conectar los controladores físicos. Los controladores de MQ-135/ADS1115, MLX90614 y batería, así como audio y vibración, no estaban implementados en este repositorio y todavía requieren integración y validación en hardware. El menú mantiene esas lecturas como pendientes hasta conectarlos.

Los mensajes sí están conectados desde la OLED/simulador hasta la web. La entrega inmediata requiere una conexión de red disponible; sin ella se utiliza la cola local.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `backend/` | API, autenticación, SQLite, ingestión del dispositivo y SignalR. |
| `web-app/` | Central React, formularios, monitoreo y pruebas de navegador. |
| `device/` | Menú OLED, botones, simulador y transporte con cola persistente. |
| `tests/backend/` | Pruebas de integración de API y WebSockets. |
| `docs/` | [Contrato de API y tiempo real](docs/api.md), hardware y documentación existente. |
| `scripts/` | Desarrollo, compilación, ejecución y pruebas. |
| `infra/` | Proxy Docker y plantillas de servicio para despliegue. |
| `compose.yaml` | Central Docker: backend, web-app y almacenamiento persistente. |
| `compose.device.yaml` | Despliegue Docker opcional para OLED y botones. |
