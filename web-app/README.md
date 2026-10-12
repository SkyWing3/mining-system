# Mining System · Web app

React + TypeScript, interfaz clara con identidad minera y WebSockets autenticados. Incluye login/configuración inicial, vista general, recepción de mensajes, revisión interna de alertas, manillas y lecturas, gestión de usuarios, actividad y cuenta.

Desde la raíz del proyecto, `./scripts/dev.sh` inicia web y API. Para iniciar solo la web:

```sh
npm ci
npm run dev
```

Abrir http://localhost:5173. Se necesita la API en http://localhost:5080. `MINING_API_TARGET` modifica el destino del proxy Vite. La web nunca genera datos de muestra; crea el administrador en el primer acceso y registra tus mineros y dispositivos.

```sh
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Las pruebas usan puertos 5174/5082 y una base temporal. Las capturas están en `test-results/`. Para servir el build junto a la API, usar `./scripts/build.sh` y `./scripts/serve.sh` desde la raíz; `vite preview` por sí solo no proporciona el proxy de la API.

## Componentes de la aplicación

Los controles visuales se implementan en [controls.tsx](src/controls.tsx) y [controls.css](src/controls.css), usando la paleta de la central. Los elementos HTML conservan su semántica de entrada y formulario; la aplicación dibuja sus controles y mensajes.

| Componente | Uso |
| --- | --- |
| `TextField` | Campos de login, usuarios, manillas y cuenta; visibilidad de contraseñas con botón propio y errores vinculados al campo. |
| `SearchField` | Búsqueda de mensajes, manillas y usuarios, con botón propio para limpiar. |
| `Select` | Filtros de prioridad, manilla y rol; selección de roles y asignación de mineros. Lista propia que se posiciona fuera del contenedor para evitar recortes. |
| `Checkbox` | Estado de cuentas y manillas, con casilla e icono dibujados por la aplicación. |
| `ApplicationForm` | Validación dentro de la aplicación, sin burbujas del navegador; enfoca el primer campo con error y detiene solicitudes inválidas. |
| `Tooltip` | Ayuda de acciones y fechas, mediante un componente propio en lugar del atributo HTML `title`. |
| `Modal` | Formularios, lecturas, credenciales y confirmaciones; conserva el foco dentro del diálogo y lo devuelve al control que lo abrió. |

Los selectores admiten flechas, Inicio/Fin, AvPág/RePág y búsqueda por letras; Enter/Espacio confirma, Tab confirma y avanza, y Escape cancela la selección pendiente. Las casillas funcionan con Espacio. Escape cierra primero una lista o ayuda abierta y después el diálogo. Los botones, pestañas, notificaciones, indicadores, tablas y barras de desplazamiento también utilizan estilos de la aplicación.

Las pruebas de navegador recorren todas las secciones y comprueban que no se rendericen selectores, tooltips ni diálogos nativos, que todos los formularios usen validación propia y que los controles funcionen con teclado y con gestos táctiles.

Consultar [README principal](../README.md) y [contrato de API](../docs/api.md) para configuración del dispositivo, roles y despliegue.
