# Docker en Ubuntu Server LTS

La central se ejecuta en tres contenedores: `mysql` almacena los datos, `web-app` sirve React con Nginx y `backend` ejecuta ASP.NET Core. Solo Nginx publica un puerto en la Raspberry. La web, `/api`, `/hubs/mining` y `/ws/device` comparten **http://franco-rasp4.local**. No se necesitan Node.js, Python ni .NET instalados en la Raspberry para ejecutar la central.

Las imágenes se construyen para la arquitectura de la máquina: ARM64 en una Raspberry Pi con sistema de 64 bits, ARM64 en Apple Silicon y AMD64 en un PC x86. No hay una arquitectura x86 fijada en Compose. Los datos MySQL viven en `mining-system_mysql-data`; las claves de sesión, en `mining-system_central-data`, fuera de las imágenes. Las contraseñas se generan en `secrets/` y MySQL no publica puertos.

## Arranque en franco-rasp4

El despliegue está preparado para **Ubuntu Server LTS de 64 bits**, incluido ARM64 en la Raspberry Pi 4B. Usar el servidor con Docker Engine y el plugin Docker Compose ya disponibles. Docker publica sus [versiones de Ubuntu LTS y arquitecturas compatibles](https://docs.docker.com/engine/install/ubuntu/#os-requirements).

Desde la raíz del proyecto, el único comando necesario es:

```sh
./start.sh
```

Si tu usuario no tiene acceso a Docker, ejecutar `sudo ./start.sh`. El script usa el directorio del proyecto aunque se invoque desde otra carpeta, compila las imágenes, inicia los tres servicios en segundo plano y espera a que estén saludables. Al terminar muestra la URL y el estado de los contenedores; si falla, muestra el estado y los últimos logs. La compilación inicial requiere Internet para descargar imágenes y dependencias.

El mismo comando sirve para arranques posteriores y para aplicar cambios del código. No requiere archivos de configuración adicionales y conserva la base de datos y las claves de sesión.

Abrir **http://franco-rasp4.local** desde el navegador y crear el administrador en el primer acceso. No hay credenciales predeterminadas. Las manillas usan **ws://franco-rasp4.local/ws/device** y la credencial generada al registrarlas en la web.

El script utiliza el mDNS existente del servidor, **`franco-rasp4.local`**. Su anuncio y resolución dependen del sistema y de la red; en una instalación con Avahi, este servicio anuncia el hostname seguido de `.local`. Debe usarse desde la misma LAN con un cliente que resuelva mDNS. El arranque de la aplicación no cambia el hostname ni instala paquetes del sistema.

Si el equipo no encuentra el nombre:

```sh
# Dentro de la Raspberry
hostname
systemctl is-active avahi-daemon
avahi-resolve-host-name -4 franco-rasp4.local
curl http://127.0.0.1/health
```

Si la IP de la Raspberry abre la web pero `.local` no, revisar mDNS/Avahi en el cliente y que la red permita multicast entre equipos. En un cliente Debian/Ubuntu: `sudo apt-get install libnss-mdns avahi-utils`. Las redes de invitados pueden aislar los equipos.

## Configuración

No hace falta crear `.env` para usar el puerto 80 y `franco-rasp4.local`. Para cambiar valores:

```sh
cp -n .env.example .env
# Editar .env y volver a ejecutar ./start.sh
```

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `MINING_HTTP_PORT` | `80` | Puerto publicado en todas las interfaces de la Raspberry. |
| `MINING_PUBLIC_ORIGIN` | `http://franco-rasp4.local` | Origen adicional permitido por la API. Incluir el puerto si no es 80. |
| `MINING_DOCKER_SUBNET` | `172.30.84.0/24` | Red privada del proxy y la API. Cambiar si coincide con otra red Docker o con la LAN. |

Si se cambia la subred de una instalación existente, ejecutar `sudo ./start.sh --down` antes de levantarla otra vez para recrear la red; el volumen de datos se conserva.

Ejemplo con un puerto ocupado por otro servicio:

```dotenv
MINING_HTTP_PORT=8088
MINING_PUBLIC_ORIGIN=http://franco-rasp4.local:8088
MINING_DOCKER_SUBNET=172.30.84.0/24
```

En ese caso, abrir `http://franco-rasp4.local:8088` y usar `ws://franco-rasp4.local:8088/ws/device`. No se fija un hostname en el JavaScript: la web conecta con el mismo origen desde el que se abre, incluso usando la IP. Compose carga `.env` automáticamente; los scripts locales de .NET no lo hacen.

La API acepta encabezados de proxy únicamente desde la red Docker configurada, además de los proxies locales predeterminados de ASP.NET. Nginx conserva el host y puerto originales y permite el cambio de protocolo para ambos WebSockets. Su resolución DNS se renueva si se recrea el contenedor del backend. Los servicios tienen comprobaciones de salud, reinicio automático, límites de memoria y rotación de logs. La API y Nginx ejecutan sin root y con el sistema de archivos de imagen de solo lectura.

## Operación y actualizaciones

```sh
# Estado y logs
sudo docker compose ps
sudo docker compose logs --tail=100 -f

# Tras actualizar el código
./start.sh

# Detener, conservando los datos
./start.sh --down

# Volver a iniciar, sin recompilar
sudo docker compose up -d --wait
```

Docker se inicia con el sistema y `restart: unless-stopped` vuelve a levantar los contenedores tras reiniciar la Raspberry, siempre que no se hayan detenido explícitamente. La actualización conserva usuarios, mensajes y claves de sesión. **`docker compose down -v` elimina los datos**: no usarlo para una parada o actualización normal.

`./start.sh --help` muestra las opciones. Si Docker requiere permisos de administrador, anteponer `sudo` también al usar `--down`.

## Respaldar e importar datos

Respaldar MySQL mediante `mysqldump --single-transaction --no-tablespaces` y
conservar aparte `central-data` (claves de sesión) y `secrets/` (credenciales).
La configuración, el procedimiento de exportación y la importación transaccional
se describen en [MySQL](mysql.md). La base anterior se conserva como respaldo;
no copiar sus archivos al directorio de datos MySQL ni mezclarlos con su volumen.

## Manilla OLED en Docker (opcional)

La central funciona con `compose.yaml` solamente. `compose.device.yaml` es un despliegue independiente para la Raspberry que tiene físicamente conectados la OLED y los botones; puede ser la Pi Zero 2 W o la propia Pi 4B.

En ese equipo, I²C debe estar habilitado y Avahi disponible para resolver `.local`. Verificar que existen `/dev/i2c-1`, `/dev/gpiochip0` y `/run/avahi-daemon/socket`.

```sh
cp -n device/config/settings.docker.example.json device/config/settings.docker.json
# Editar connection.api_key con la credencial de esta manilla.
# Si la central usa otro puerto, editar también connection.url.
sudo docker compose -f compose.device.yaml up -d --build
sudo docker compose -f compose.device.yaml logs --tail=100 -f
```

El JSON privado se monta en solo lectura y no entra en la imagen ni en Git. La cola se guarda en el volumen `mining-device_device-outbox`. El contenedor usa la red del host para acceder al Avahi local y solo recibe los dos dispositivos indicados; no usa `privileged`. Ejecuta como root para abrir los dispositivos GPIO/I²C, con capacidades eliminadas. Este despliegue requiere Linux y hardware físico; el simulador con ventana se sigue ejecutando fuera de Docker.

En la Pi Zero 2 W, usar también un sistema de 64 bits y Docker disponible, conservando su propio hostname.

## Verificación del despliegue

```sh
docker compose config --quiet
docker compose -f compose.device.yaml config --quiet
```

Las pruebas ejecutan `start.sh` desde otra carpeta, construyen y levantan una central aislada, comprueban login, rutas React/API, ambos WebSockets y persistencia tras recrear la API. Usan un proyecto/volumen temporal y no tocan el volumen de producción:

```sh
# Docker funcionando y dependencias Python de las pruebas instaladas
device/.venv/bin/python -m unittest discover -s tests/docker -v
```

`.dockerignore` permite solo el código y los archivos necesarios para compilar: quedan fuera los datos, las credenciales, `.env`, la configuración privada del dispositivo y los resultados generados.
