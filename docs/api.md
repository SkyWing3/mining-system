# API y comunicación en tiempo real

## Autenticación de operadores

Login por cookie `mining.session`, HttpOnly, SameSite Strict, duración de ocho horas. En HTTPS la cookie es Secure. No se guarda un token en localStorage. Todos los endpoints `/api` salvo `auth/status`, `auth/setup` y `auth/login` requieren autenticación. Los cuerpos son JSON. Las mutaciones requieren `X-Mining-Client: web` y un origen autorizado si el navegador lo envía.

El login y la configuración inicial tienen un límite de 12 solicitudes por IP por minuto. Las fechas se entregan en UTC con `Z`; el cliente muestra America/La_Paz. El contador de mensajes de hoy también usa la jornada de Bolivia.

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
| GET | `/api/devices` | Admin/Supervisor; dispositivos con presencia y última lectura. |
| POST | `/api/devices` | `{ name, zone, userId, active }`; `{ device, apiKey }`, credencial solo una vez. |
| PUT | `/api/devices/{id}` | Actualiza asignación, zona y estado; no devuelve la credencial. |
| POST | `/api/devices/{id}/rotate-key` | Devuelve nueva credencial e invalida la anterior. |
| GET | `/api/overview` | Contadores, ocho últimos mensajes y catálogo. |
| GET | `/api/messages` | Historial paginado y filtros. |
| POST | `/api/messages/{id}/review` | Revisión interna de una alerta crítica, idempotente. |
| GET | `/api/devices/{id}/telemetry` | Últimas 100 lecturas, de reciente a antigua, con `minerName` y `zone` registrados al recibir cada una. |
| GET | `/api/events` | Últimas 100 acciones administrativas. |
| GET | `/openapi/v1.json` | Descripción de API, solo en entorno Development. |

Roles válidos: `Admin`, `Supervisor`, `Miner`. El panel requiere Admin o Supervisor. Los mineros son portadores de dispositivos. Se protege el último administrador activo; no se permite desactivar la propia cuenta. Desasignar las manillas activas antes de desactivar un minero o cambiar su rol. Cada minero tiene como máximo una manilla activa; los registros se conservan para proteger el historial.

### Historial

`GET /api/messages?page=1&pageSize=25&search=derrumbe&severity=critical&deviceId=...&pending=true`

Todos los filtros son opcionales. `pageSize` está limitado a 100. `severity` admite `critical`, `warning` e `info`. `pending=true` selecciona mensajes sin revisar. La búsqueda incluye texto del catálogo, minero, dispositivo y zona. Respuesta:

```json
{
  "items": [{
    "id": 1,
    "deviceId": "...",
    "code": "HELP",
    "text": "Ayuda",
    "severity": "critical",
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

## Manilla → central: WebSocket nativo

Conectar a `ws://CENTRAL:5080/ws/device` o `wss://DOMINIO/ws/device` y enviar la cabecera `X-Device-Key` con la credencial de la manilla. No poner credenciales en la URL. El servidor verifica el hash al conectar y en cada trama; una credencial revocada o manilla desactivada cierra el socket. La manilla necesita un minero activo asignado para enviar mensajes.

El socket recibe JSON de texto de hasta 8 KB. Cierra después de 75 segundos sin una trama. El dispositivo envía un heartbeat cada 20 segundos y reintenta la conexión con espera creciente hasta 20 segundos. La web considera el dispositivo conectado si se recibió un evento válido en los últimos 90 segundos; revisa cambios de presencia cada 15 segundos.

### Mensaje

```json
{
  "type": "message",
  "clientMessageId": "un-uuid-estable-por-mensaje",
  "code": "COLLAPSE",
  "sentAt": "2026-10-12T14:00:00Z"
}
```

| Código | Texto en la central | Prioridad |
| --- | --- | --- |
| HELP | Ayuda | critical |
| OK | Todo bien | info |
| COLLAPSE | Hay derrumbe | critical |
| GAS | Presencia de gas | critical |
| INJURY | Compañero herido | critical |
| EVACUATE | Necesito evacuar | critical |
| SUPPLIES | Necesito suministros | warning |
| EXIT | Saliendo de la mina | info |

La central acepta únicamente estos códigos. Fecha obligatoria, no más de cinco minutos en el futuro. La clave única `(deviceId, clientMessageId)` hace que un reintento devuelva el mismo ID sin añadir otro mensaje. Usar un código diferente con el mismo identificador se rechaza.

```json
{
  "type": "ack",
  "clientMessageId": "un-uuid-estable-por-mensaje",
  "messageId": 1,
  "duplicate": false,
  "serverTime": "2026-10-12T14:00:01Z"
}
```

Esta confirmación se envía después del guardado y significa **recibido por la central**, no leído por un operador. La cola del dispositivo conserva el mensaje hasta recibir un `ack` con el identificador correcto. Una pérdida de confirmación causa un reintento seguro. Una trama inválida devuelve `{ "type": "error", "message": "..." }`; el dispositivo conserva su cola y muestra la falta de confirmación. Una manilla sin asignación necesita corregirse en la web para poder vaciar la cola.

### Presencia y lecturas

```json
{ "type": "heartbeat" }
```

```json
{
  "type": "telemetry",
  "temperatureC": 28.6,
  "gasPpm": 410,
  "batteryPercent": 86
}
```

Los campos de lectura son opcionales, pero se requiere al menos uno. Los ausentes se guardan como `null`. Límites de validación de transporte: temperatura −50..150 °C, gas 0..1000000 ppm y batería 0..100 %. Estos límites no son umbrales de seguridad. Gas solo debe enviarse como ppm después de calibrar el sensor. El backend guarda y transmite lecturas; no diagnostica riesgo a partir de un SEN0564 sin calibración.

Un heartbeat no crea una lectura. La última lectura y su fecha se conservan cuando una manilla queda sin conexión. La UI distingue la presencia de la disponibilidad de mediciones.

## Central → web: SignalR sobre WebSocket

Ruta `/hubs/mining`, cookie de operador y roles Admin/Supervisor. El cliente exige transporte WebSocket. El hub no expone métodos para responder a mineros. Eventos:

| Evento | Contenido |
| --- | --- |
| `MessageReceived` | Mensaje completo persistido. |
| `MessageReviewed` | Mensaje con autor y fecha de revisión interna. |
| `TelemetryReceived` | `{ deviceId, reading }`. |
| `SystemChanged` | Categoría: `users`, `devices`, `messages` o `presence`. |

La web actualiza sus vistas al recibir eventos. No usa sondeo periódico para mensajes. Después de reconectar vuelve a consultar el historial y los contadores para recuperar lo ocurrido durante el corte. También identifica el estado offline del navegador. Las sesiones revocadas cierran sus sockets y las caducadas se revalidan, como máximo, cada 15 segundos.

El flujo es **manilla → central → operador**. No hay API ni caja de texto para respuestas desde la web. Una revisión de alerta solo cambia el historial de la central; no se emite una trama hacia el dispositivo.

## Persistencia y despliegue

Una instancia central utiliza MySQL con claves foráneas, índices y transacciones. Una exclusión de mutaciones en la API protege asignaciones, administradores y reintentos concurrentes dentro de esa instancia. El esquema se versiona en `backend/Migrations/` y se actualiza mediante `Database.MigrateAsync()`. Las fechas se guardan en UTC con `datetime(6)`; MySQL no conserva la zona horaria dentro de esa columna. Respaldar MySQL mediante un volcado consistente y conservar aparte las claves de sesión y secretos de conexión. Consultar [MySQL y migración](mysql.md).

El despliegue incluido sirve React y API en el mismo origen. Para una web separada, configurar `Mining:AllowedOrigins` explícitamente y conservar el envío de cookies; la política SameSite exige un entorno compatible. Nginx debe permitir Upgrade tanto en `/hubs/` como en `/ws/`. Consultar las plantillas de `infra/`.

Referencias de implementación: [SignalR JavaScript](https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client?view=aspnetcore-10.0), [autenticación de SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz?view=aspnetcore-10.0), [MySQL y EF Core](https://dev.mysql.com/doc/connector-net/en/connector-net-entityframework-core.html) y [cliente WebSocket Python](https://websockets.readthedocs.io/en/stable/reference/sync/client.html).
