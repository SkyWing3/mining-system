# Informe final de Mining System

Fuente principal: `../informe_final_iot_2026.tex`. PDF: `../informe_final_iot_2026.pdf`.

Compilar desde `docs/`, con TeX Live y XeLaTeX:

```sh
latexmk -xelatex -interaction=nonstopmode -halt-on-error informe_final_iot_2026.tex
```

El documento utiliza TeX Gyre Heros/Cursor incluidos en TeX Live. Las figuras y
listados se resuelven mediante rutas relativas dentro de `informe/`. El ZIP de
entrega conserva esa estructura y se puede compilar sin el código del servidor.

## Contenido

- `figuras/`: capturas reales obtenidas de las pruebas de navegador con MySQL;
  fotogramas de la OLED generados por el renderizador del nodo; plano ilustrado.
- `evidencias/api-mysql.json`: diez solicitudes HTTP reales, evento SignalR,
  ACK e idempotencia, lectura y consulta de claves foráneas en una base temporal.
- `evidencias/mysql-schema.sql`: esquema generado por EF Core para MySQL.
- `evidencias/pruebas-dispositivo.txt`: salida real de las 16 pruebas del nodo.
- `evidencias/resultados.json`: resumen de las 47 pruebas y del entorno validado.
- `creditos/`: licencia de los dibujos de Wokwi Elements usados en el plano.

El programa del nodo usa CPython y el dashboard usa React; el informe describe
esas implementaciones. Los datos de sensores en pruebas son valores controlados,
no mediciones físicas. La validación estructural de Wokwi se distingue de una
simulación funcional. Docker Compose tiene configuración verificada; el stack
MySQL completo de contenedores no se ejecutó en esta sesión.

`recolectar.py` necesita el repositorio completo, el backend compilado, las
dependencias Python de `device/.venv`, MySQL configurado para pruebas y las
capturas generadas por Playwright. Su ejecución reconstruye el registro de API
en una base temporal y elimina esa base al finalizar; no toca la base migrada.
Para recompilar el PDF con nuevas evidencias, regenerar también `datos.tex`,
`trama.json` y `ack.json` desde el nuevo registro antes de compilar.
