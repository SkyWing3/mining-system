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

Consultar [README principal](../README.md) y [contrato de API](../docs/api.md) para configuración del dispositivo, roles y despliegue.
