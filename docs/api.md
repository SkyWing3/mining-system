# API y comunicación en tiempo real

La central expone cuatro canales:

| Canal | Ruta | Uso |
| --- | --- | --- |
| REST (cookie de operador) | `/api/...` | Gestión, consultas, revisión de alertas, voz y avisos. |
| WebSocket nativo (credencial de manilla) | `/ws/device` | Mensajes, telemetría en vivo y avisos en ambos sentidos. |
| HTTP de dispositivo (credencial de manilla) | `POST /api/device/voice` | Subida de mensajes de voz. |
| SignalR sobre WebSocket (cookie de operador) | `/hubs/mining` | Eventos en vivo hacia la web. |

## Autenticación de operadores

Login por cookie `mining.session`, HttpOnly, SameSite Strict, duración de ocho horas. En HTTPS la cookie es Secure. No se guarda un token en localStorage. Todos los endpoints `/api` salvo `auth/status`, `auth/setup`, `auth/login` y `device/voice` requieren autenticación. Los cuerpos son JSON. Las mutaciones con cookie requieren `X-Mining-Client: web` y un origen autorizado si el navegador lo envía; la subida de voz se autentica con `X-Device-Key` y no usa cookies.

El login y la configuración inicial tienen un límite por IP por minuto (`Mining:LoginAttemptsPerMinute`, 12 por defecto). Las fechas se entregan en UTC con `Z`; el cliente muestra America/La_Paz. El contador de mensajes de hoy también usa la jornada de Bolivia. Los errores devuelven `{ "message": "..." }` con el código HTTP correspondiente (400, 401, 403, 404, 409, 413, 415, 429).

| Método | Ruta | Acceso / resultado |
| --- | --- | --- |
| GET | `/health` | Público; estado del proceso. |
| GET | `/api/auth/status` | Público; `{ setupRequired }`. |
| POST | `/api/auth/setup` | Solo mientras no haya usuarios; `{ name, email, password }`; crea Admin y abre sesión. |
| POST | `/api/auth/login` | `{ email, password }`; devuelve el perfil y una cookie. |
| GET | `/api/auth/me` | Perfil actual, sin hashes. |
| POST | `/api/auth/logout` | Cierra sesión e invalida conexiones previas del usuario. |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }`; renueva la sesión actual. |
| GET | `/api/users` | Admin; usuarios. |
| POST | `/api/users` | Admin; `{ name, email, role, active, password }`. |
| PUT | `/api/users/{id}` | Admin; mismos campos; `password: null` conserva la actual. |
| GET | `/api/devices/miners` | Admin/Supervisor; mineros activos para asignaciones. |
| GET | `/api/devices` | Admin/Supervisor; dispositivos con presencia y última lectura (incluida la última lectura en vivo). |
| POST | `/api/devices` | `{ name, zone, userId, active }`; `{ device, apiKey }`, credencial solo una vez. |
| PUT | `/api/devices/{id}` | Actualiza asignación, zona y estado; deshabilitar cierra su WebSocket. |
| POST | `/api/devices/{id}/rotate-key` | Devuelve nueva credencial, invalida la anterior y cierra su WebSocket. |
| GET | `/api/devices/{id}/telemetry?since=&limit=` | Lecturas guardadas, de reciente a antigua, con `minerName`, `deviceName` y `zone` registrados al recibir cada una; `limit` 1–1000 (100 por defecto). |
| GET | `/api/overview` | Contadores, ocho últimos mensajes, catálogo de mensajes y de avisos. |
| GET | `/api/messages` | Historial paginado y filtros. |
| POST | `/api/messages/{id}/review` | Revisión interna de una alerta crítica, idempotente. |
| GET | `/api/voice?page=&pageSize=&pending=&deviceId=` | Mensajes de voz paginados. |
| GET | `/api/voice/{id}/audio` | Audio WAV; admite `Range`. |
| POST | `/api/voice/{id}/review` | Marca un mensaje de voz como escuchado, idempotente. |
| GET | `/api/notices?page=&pageSize=&pending=&deviceId=` | Historial de avisos con su estado. |
| GET | `/api/notices/catalog` | Avisos disponibles. |
| POST | `/api/notices` | `{ code, deviceIds }` o `{ code, all: true }`; un aviso por manilla habilitada. |
| GET | `/api/events` | Últimas 100 acciones administrativas. |
| POST | `/api/device/voice` | Manilla; subida de voz (ver más abajo). |
| GET | `/openapi/v1.json` | Descripción de API, solo en entorno Development. |

Roles válidos: `Admin`, `Supervisor`, `Miner`. El panel requiere Admin o Supervisor. Los mineros son portadores de dispositivos. Se protege el último administrador activo; no se permite desactivar la propia cuenta. Desasignar las manillas activas antes de desactivar un minero o cambiar su rol. Cada minero tiene como máximo una manilla activa; los registros se conservan para proteger el historial. Cambiar rol, estado, correo o contraseña invalida las sesiones del usuario; cambiar solo el nombre no.

`overview` incluye `totalDevices`, `onlineDevices`, `activeMiners`, `messagesToday`, `pendingAlerts`, `liveDanger` (manillas conectadas cuya lectura reciente está en peligro), `pendingVoice`, `pendingNotices`, `recentMessages`, `catalog` (con `automatic`) y `noticeCatalog`.

### Historial

`GET /api/messages?page=1&pageSize=25&search=derrumbe&severity=critical&deviceId=...&pending=true`

Todos los filtros son opcionales. `pageSize` está limitado a 100. `severity` admite `critical`, `warning` e `info`. `pending=true` selecciona mensajes sin revisar. La búsqueda no distingue mayúsculas ni tildes e incluye texto del catálogo, minero, dispositivo y zona. Respuesta:

```json
{
  "items": [{
    "id": 1,
    "deviceId": "...",
    "code": "CO_ALARM",
    "text": "Alarma de CO",
    "severity": "critical",
    "detail": "CO 245 ppm",
    "minerName": "Javier Mamani",
    "deviceName": "Manilla 01",
    "zone": "Galería norte",
    "sentAt": "2026-10-12T14:00:00Z",
    "receivedAt": "2026-10-12T14:00:01Z",
    "reviewedAt": null,
    "reviewedBy": null
  }],
  "total": 1,
  "page": 1,
  "pageSize": 25
}
```

El mensaje conserva el nombre del portador y la zona asignados al recibirlo; reasignaciones posteriores no modifican el registro. `receivedAt` es la fecha del servidor; `sentAt` proviene del reloj del dispositivo. Mantener sincronizados los relojes de las Raspberry Pi.

## Manilla ↔ central: WebSocket nativo

Conectar a `ws://CENTRAL:5080/ws/device` o `wss://DOMINIO/ws/device` y enviar la cabecera `X-Device-Key` con la credencial de la manilla. No poner credenciales en la URL. El servidor verifica el hash al conectar y en cada trama; una credencial revocada o una manilla deshabilitada cierra el socket en el momento (código 1008). Cada manilla mantiene un solo socket: una conexión nueva reemplaza a la anterior.

El socket transporta JSON de texto de hasta 8 KB. Cierra después de 75 segundos sin una trama. La manilla mantiene **una solicitud en vuelo**: envía una trama y espera su `ack` o `error`. La central también puede enviar, en cualquier momento, tramas `notice`; el cliente las separa de las respuestas por su `type`.

La manilla envía telemetría cada `telemetry_seconds` (2 s por defecto) y, si no tiene sensores, un heartbeat cada 20 segundos. Reintenta la conexión con espera creciente hasta 20 segundos. La web considera el dispositivo conectado si se recibió un evento válido en los últimos 90 segundos (`Mining:PresenceWindowSeconds`); revisa cambios de presencia cada 15 segundos.

### Heartbeat

```json
{ "type": "heartbeat" }
```

Su `ack` incluye la identidad que la OLED muestra en Ajustes:

```json
{ "type": "ack", "duplicate": false, "serverTime": "2026-10-12T14:00:01Z",
  "device": { "name": "Manilla 01", "minerName": "Javier Mamani", "zone": "Galería norte" } }
```

### Mensaje

```json
{
  "type": "message",
  "clientMessageId": "un-uuid-estable-por-mensaje",
  "code": "COLLAPSE",
  "sentAt": "2026-10-12T14:00:00Z"
}
```

| Código | Texto en la central | Prioridad | Origen |
| --- | --- | --- | --- |
| HELP | Ayuda | critical | Menú |
| OK | Todo bien | info | Menú |
| COLLAPSE | Hay derrumbe | critical | Menú |
| GAS | Presencia de gas | critical | Menú |
| INJURY | Compañero herido | critical | Menú |
| EVACUATE | Necesito evacuar | critical | Menú |
| SUPPLIES | Necesito suministros | warning | Menú |
| EXIT | Saliendo de la mina | info | Menú |
| CO_ALARM | Alarma de CO | critical | Automático |
| HEAT_ALARM | Alarma de temperatura | critical | Automático |

La central acepta únicamente estos códigos. Fecha obligatoria, no más de cinco minutos en el futuro. Los códigos automáticos admiten `detail` (hasta 120 caracteres, por ejemplo `"CO 245 ppm"`); los demás lo rechazan. La clave única `(deviceId, clientMessageId)` hace que un reintento devuelva el mismo ID sin añadir otro mensaje. Usar un código diferente con el mismo identificador se rechaza.

```json
{
  "type": "ack",
  "clientMessageId": "un-uuid-estable-por-mensaje",
  "messageId": 1,
  "duplicate": false,
  "serverTime": "2026-10-12T14:00:01Z"
}
```

Esta confirmación se envía después del guardado y significa **recibido por la central**, no leído por un operador. La cola del dispositivo conserva el mensaje hasta recibir un `ack` con el identificador correcto. Una pérdida de confirmación causa un reintento seguro.

### Errores

```json
{ "type": "error", "code": "invalid", "message": "Mensaje fuera del catálogo." }
```

| `code` | Significado | Acción de la manilla |
| --- | --- | --- |
| `invalid` | La trama nunca será aceptada. | La mueve a `rejected/` para inspección. |
| `unassigned` | La manilla no tiene un minero activo asignado. | La conserva y reintenta; corregir la asignación en la web. |
| `unavailable` | Falla temporal al guardar. | La conserva y reintenta. |
| `unauthorized` | Credencial revocada o manilla/minero desactivado. | El socket se cierra; reconecta con espera creciente. |

### Telemetría en vivo

```json
{
  "type": "telemetry",
  "temperatureC": 24.3,
  "objectTemperatureC": 26.1,
  "gasPpm": 12,
  "gasVoltage": 0.143,
  "level": "normal",
  "simulated": false
}
```

| Campo | Origen | Límites de transporte |
| --- | --- | --- |
| `temperatureC` | MLX90614, temperatura ambiente | −50..150 °C |
| `objectTemperatureC` | MLX90614, temperatura de objeto | −70..380 °C |
| `gasPpm` | SEN0564, solo con calibración configurada | 0..1 000 000 ppm |
| `gasVoltage` | SEN0564 en A0 del ADS1115 | 0..5,5 V |
| `batteryPercent` | Sin hardware en el circuito actual; se omite | 0..100 % |
| `level` | Nivel calculado por la manilla con sus umbrales | `normal`, `caution`, `danger` |
| `simulated` | `true` si proviene del simulador | — |

Los campos de lectura son opcionales, pero se requiere al menos uno. Los ausentes se guardan como `null`. Los límites son de validación de datos, no umbrales de seguridad. Gas solo se envía en ppm después de calibrar el sensor; sin calibración se envía la tensión.

Cada lectura se difunde **inmediatamente** a la web. MySQL guarda como máximo una lectura por manilla cada `Mining:Telemetry:PersistIntervalSeconds` (10 s por defecto; 0 guarda todas) y, además, cada cambio de `level`, de minero o de zona; así el historial conserva las transiciones y reasignaciones sin crecer con cada muestra. Cada lectura guardada registra el minero, la manilla y la zona del momento en que se recibió, y la base la conserva como historial de solo inserción (no se modifica ni se elimina). Un heartbeat no crea una lectura. La última lectura y su fecha se conservan cuando una manilla queda sin conexión.

### Avisos de la central

Al crear un aviso desde la web se guarda un registro por manilla y se envía de inmediato a las conectadas. Las demás lo reciben **después del primer `ack` de su próxima conexión**, mientras no haya caducado (`Mining:Notices:ExpirationMinutes`, 30 por defecto). Un aviso entregado pero no leído se vuelve a enviar en cada reconexión.

```json
{ "type": "notice", "noticeId": 12, "code": "EVACUATE", "text": "Evacuar ahora", "severity": "critical",
  "createdAt": "2026-10-12T14:00:00Z", "expiresAt": "2026-10-12T14:30:00Z" }
```

| Código | Texto | Prioridad |
| --- | --- | --- |
| EVACUATE | Evacuar ahora | critical |
| SURFACE | Volver a superficie | warning |
| SHELTER | Ir al refugio | warning |
| HELP_COMING | Ayuda en camino | info |
| RECEIVED | Mensaje recibido | info |
| REPORT | Reporta tu estado | info |

La manilla confirma la entrega al recibirlo y la lectura cuando el minero pulsa Enter. Ambas confirmaciones pasan por su cola durable, de modo que una lectura hecha sin red se informa al reconectar:

```json
{ "type": "notice-ack", "noticeId": 12, "stage": "delivered" }
{ "type": "notice-ack", "noticeId": 12, "stage": "read" }
```

Estados en la web: `pending`, `delivered`, `read` y `expired` (no entregado antes de caducar).

## Manilla → central: mensajes de voz

```http
POST /api/device/voice
Content-Type: audio/wav
X-Device-Key: <credencial de 64 caracteres>
X-Client-Message-Id: <identificador estable, [A-Za-z0-9_-]{1,80}>
X-Recorded-At: 2026-10-12T14:00:00Z

<WAV PCM mono de 16 bits, 8–48 kHz>
```

Se usa HTTP porque una grabación supera el límite de 8 KB de las tramas WebSocket. La central valida la cabecera RIFF, el formato (PCM, mono, 16 bits, 8–48 kHz), la duración (0,3 s a `Mining:Voice:MaxSeconds`, 60 por defecto) y el tamaño (`Mining:Voice:MaxBytes`, 2 MB). La manilla necesita un minero asignado. El archivo se guarda en `{DataDirectory}/voice/aaaa/mm/` con un nombre generado por el servidor. Hay un límite de `Mining:Voice:UploadsPerMinute` subidas por credencial.

| Respuesta | Significado |
| --- | --- |
| 201 `{ voice, duplicate: false }` | Guardado y anunciado a la web. |
| 200 `{ voice, duplicate: true }` | Reintento de una grabación ya guardada. |
| 400 / 413 / 415 | Audio inválido, demasiado grande o de otro tipo: la manilla lo aparta. |
| 401 | Credencial inválida. |
| 409 | Manilla sin minero asignado: se reintenta. |
| 429 / 5xx | Se reintenta más tarde. |

## Central → web: SignalR sobre WebSocket

Ruta `/hubs/mining`, cookie de operador y roles Admin/Supervisor. El cliente exige transporte WebSocket. El hub está tipado (`IMiningClient`) y no expone métodos de cliente a servidor. Eventos:

| Evento | Contenido | Efecto en la web |
| --- | --- | --- |
| `TelemetryReceived` | `{ deviceId, reading }` con la lectura completa | Actualiza tarjetas, tabla y gráficos sin consultar la API. |
| `MessageReceived` | Mensaje completo persistido | Lo agrega a la vista general, avisa y actualiza contadores. |
| `MessageReviewed` | Mensaje con autor y fecha de revisión | Actualiza historial y contadores. |
| `VoiceMessageReceived` | Mensaje de voz | Avisa y actualiza la bandeja de voz. |
| `VoiceMessageReviewed` | Mensaje de voz escuchado | Actualiza la bandeja. |
| `NoticeUpdated` | Aviso con su estado | Actualiza el historial de avisos. |
| `SystemChanged` | `users`, `devices`, `messages`, `presence`, `voice` o `notices` | Vuelve a consultar solo esa parte. |

Las lecturas en vivo no provocan consultas: la web aplica el payload directamente y conserva los últimos 10 minutos de cada manilla para sus curvas. Al abrir el monitoreo en vivo carga la parte guardada de esa ventana. Después de reconectar vuelve a consultar historial, contadores y lecturas para recuperar lo ocurrido durante el corte. También identifica el estado offline del navegador. Las sesiones revocadas cierran sus sockets y las caducadas se revalidan, como máximo, cada 15 segundos.

## Persistencia y despliegue

Una instancia central utiliza MySQL con claves foráneas, índices y transacciones. Una exclusión de mutaciones en la API protege asignaciones, administradores y reintentos concurrentes dentro de esa instancia; la telemetría no pasa por ella. El esquema se versiona en `backend/Migrations/` y se actualiza mediante `Database.MigrateAsync()`. Las fechas se guardan en UTC con `datetime(6)`; MySQL no conserva la zona horaria dentro de esa columna. Respaldar MySQL mediante un volcado consistente y conservar aparte las claves de sesión, los audios (`voice/`) y los secretos de conexión. Consultar [MySQL y migración](mysql.md).

El despliegue incluido sirve React y API en el mismo origen. Para una web separada, configurar `Mining:AllowedOrigins` explícitamente y conservar el envío de cookies; la política SameSite exige un entorno compatible. Nginx debe permitir Upgrade tanto en `/hubs/` como en `/ws/` y un cuerpo de hasta 3 MB en `/api/device/voice`. Consultar las plantillas de `infra/`.

Referencias de implementación: [SignalR JavaScript](https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client?view=aspnetcore-10.0), [hubs fuertemente tipados](https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs?view=aspnetcore-10.0#strongly-typed-hubs), [autenticación de SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz?view=aspnetcore-10.0), [MySQL y EF Core](https://dev.mysql.com/doc/connector-net/en/connector-net-entityframework-core.html) y [cliente WebSocket Python](https://websockets.readthedocs.io/en/stable/reference/sync/client.html).
