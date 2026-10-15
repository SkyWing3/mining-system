# MySQL y migración

La API usa MySQL, EF Core 10 y `MySql.EntityFrameworkCore` 10.0.9. El esquema
está versionado en `backend/Migrations/`; `Database.MigrateAsync()` aplica los
cambios al arrancar. SQLite no forma parte de la API ni del programa de la manilla.

## Docker

`./start.sh` levanta MySQL 8.4 LTS, la API y Nginx/React. El servicio MySQL no
publica puertos; solo la API accede a su red privada. Los datos quedan en el
volumen `mysql-data`, y las claves de sesión, en `central-data`.

El primer arranque genera dos contraseñas aleatorias en `secrets/`: una para
la cuenta `mining`, limitada a su base, y otra para la administración. Se montan
como secretos y se conservan entre reinicios. La carpeta tiene permisos 700 y
queda fuera de Git; el archivo de la cuenta de API permite lectura desde el UID
del contenedor. Para otra ubicación, exportar `MINING_SECRETS_DIRECTORY`.

## Desarrollo local

Crear una base y un usuario MySQL, y definir:

```sh
export Mining__ConnectionString='Server=127.0.0.1;Port=3306;Database=mining_system;User ID=mining;Password=TU_CLAVE;SslMode=Preferred'
./scripts/dev.sh
```

Alternativamente, guardar `{"connectionString":"..."}` en `data/mysql.json`,
con permisos 600. Se usa solo cuando no existe la variable de entorno.
`Mining__PasswordFile` permite separar la contraseña, como hace Compose.
`Mining__DataDirectory` controla las claves de sesión/configuración local,
no los archivos internos de MySQL.

La instancia local preparada durante la migración escucha en **127.0.0.1:33307**,
usa `data/mysql-server/` y guarda la conexión en `data/mysql.json`. Si está
detenida, se puede iniciar desde la raíz con el MySQL de Homebrew:

```sh
mysqld --no-defaults --datadir="$PWD/data/mysql-server" \
  --port=33307 --socket=/tmp/mining-mysql.sock \
  --pid-file="$PWD/data/mysql-server.pid" \
  --log-error="$PWD/data/mysql-server.log" \
  --bind-address=127.0.0.1 --mysqlx=0
```

## Conservar datos de la versión anterior

Detener primero la API anterior. El exportador abre su archivo en solo lectura
y genera un JSON privado; el nuevo backend importa en una sola transacción:

```sh
python3 scripts/export-legacy-database.py data/mining.db data/mysql-migration.json
dotnet run --project backend/backend.csproj --no-launch-profile -- \
  --import-legacy "$PWD/data/mysql-migration.json"
```

La importación **exige una base destino vacía**. Conserva IDs, hashes de
contraseña, versiones de sesión, claves de manillas, mensajes, lecturas y eventos.
No elimina ni modifica el archivo original. Conservar `data/keys/` permite
mantener las cookies existentes. El JSON también contiene hashes: mantenerlo
privado y fuera de Git. El exportador es una utilidad de conversión puntual,
el único archivo que importa el motor anterior; no se carga en la aplicación.

## Cola local sin base de datos

`connection.outbox_path` apunta ahora a un **directorio**, por ejemplo
`../state/outbox`. Cada mensaje se guarda en JSON mediante archivo temporal,
`fsync`, renombrado atómico y bloqueo entre procesos. La cola funciona sin red
y conserva el identificador hasta recibir un `ack` coincidente. MySQL solo se
usa en la central, evitando que la manilla dependa de una base remota para guardar.

Si existe una cola antigua en un archivo, no borrarla ni usar ese archivo como
directorio: vaciarla con la versión anterior hasta confirmar sus mensajes y luego
configurar el nuevo directorio. La nueva versión rechaza rutas que aún sean archivo.

## Pruebas

Se crean bases aleatorias `mining_test_api_*` y `mining_test_browser_*`, con
migraciones reales, y se eliminan al finalizar. Se requiere el cliente `mysql`:

```sh
export MINING_TEST_MYSQL_HOST=127.0.0.1
export MINING_TEST_MYSQL_PORT=3306
export MINING_TEST_MYSQL_USER=usuario_de_pruebas
export MINING_TEST_MYSQL_PASSWORD=CLAVE_DE_PRUEBAS
./scripts/test.sh
```

También se admite el archivo privado `data/mysql-test.json` (permisos 600), con
`host`, `port`, `user` y `password`. El usuario de pruebas necesita permisos para
crear y eliminar estas bases. Nunca utilizar el nombre de una base de aplicación.

## Respaldos

Usar `mysqldump --single-transaction --no-tablespaces mining_system` con la cuenta
de la aplicación. Guardar el volcado, `central-data` y `secrets/` en un lugar
privado. `docker compose down -v` elimina los volúmenes: no usarlo para actualizar
o detener normalmente.
