# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Operadores (usuarios principales del panel):** supervisores y administradores de la operación minera. Trabajan en una **sala de control en superficie**, con la central abierta en un monitor fijo durante todo el turno para vigilar en vivo. El celular es solo un respaldo (confirmado).
- **Su trabajo:** saber a tiempo quién está en riesgo, en qué zona y desde cuándo; recibir reportes, alarmas automáticas y mensajes de voz desde las manillas; enviar avisos predefinidos y comprobar que el minero los leyó; registrar la revisión de alertas; administrar manillas, asignaciones y cuentas.
- **Administrador:** todo lo anterior, más la gestión de usuarios. **Supervisor:** todo excepto la gestión de usuarios.
- **Minero:** lleva la manilla y figura como titular de sus lecturas. **No accede al panel.** Usa una pantalla OLED con tres botones, a menudo con guantes, en la oscuridad de la mina y sin cobertura celular. El panel representa su situación, pero no está hecho para él.
- **Objetivo de diseño:** las decisiones de producto se toman como si fuera para una **operación minera real**. La defensa académica (curso de Internet de las Cosas, UCB) sirve de prueba, no es el objetivo (confirmado).

## Product Purpose

Mining System es la central de operaciones de una manilla minera IoT. Atiende dos necesidades de la mina: reaccionar rápido ante un incidente y construir un historial trazable de cómo el ambiente afecta a cada trabajador.

El producto funciona bien cuando:
- con enlace disponible, un reporte o una alarma llega a la central al instante;
- si el enlace se corta, no se pierde ningún reporte y no se finge ninguna entrega;
- el historial de cada trabajador sigue correctamente atribuido aunque las manillas cambien de portador o de zona.

## Positioning

Es una plataforma propia de punta a punta (manilla, central y panel) que no depende de la cobertura celular: funciona sobre una red Wi-Fi local que enlaza la manilla con la central. Su diferencia está en la entrega con confirmación y la atribución inmutable:

- La manilla guarda cada mensaje en una cola local durable (**Guardado en cola**) y solo lo marca **Enviado a central** cuando el servidor confirma que lo guardó. Un identificador estable evita duplicados.
- Al recibir cada mensaje y lectura se copian el minero, la manilla y la zona de ese momento. El historial de lecturas es de solo inserción, y los triggers de MySQL impiden borrarlo o alterarlo.

## Operating Context

- **Sala de control durante el turno.** Las sesiones duran ocho horas. La jornada y la hora son las de Bolivia.
- **Despliegue:** una Raspberry Pi 4B con Ubuntu Server LTS y Docker (`./start.sh`), accesible en la red local en `http://franco-rasp4.local` mediante mDNS. En desarrollo: `./scripts/dev.sh` → `http://localhost:5173` (web) y `http://localhost:5080` (API).
- **Primer acceso:** se crea el administrador. No hay cuentas predeterminadas ni datos de muestra.
- **Flujo:** crear usuarios → registrar manillas con su zona y su minero (la credencial se muestra una sola vez) → configurar el dispositivo → las lecturas aparecen en **En vivo** → los mensajes llegan a **Mensajes**, **Vista general** y, si son críticos, a **Alertas**; las grabaciones llegan a **Voz** → los avisos pasan de **Pendiente** a **Entregado** y a **Leído** cuando el minero confirma con Enter.
- **Reportes predefinidos de la manilla:** Ayuda, Todo bien, Hay derrumbe, Presencia de gas, Compañero herido, Necesito evacuar, Necesito suministros y Saliendo de la mina. Además, la manilla envía las alarmas automáticas **Alarma de CO** y **Alarma de temperatura** con el valor medido.
- **Ritmo de datos:** la manilla muestrea cada 1 s y transmite cada 2 s. La central guarda una lectura cada 10 s y también cada cambio de nivel, minero o zona. Todas las lecturas se transmiten en vivo.
- **Lado del dispositivo:** pantalla OLED SSD1306, tres botones, LED RGB, buzzer y motor vibrador. La manilla avisa al trabajador con luz, sonido y vibración.

## Capabilities and Constraints

- **Secciones del panel:** Vista general, En vivo, Mensajes, Alertas, Voz, Avisos, Manillas, Usuarios (solo administrador), Actividad, Mi cuenta y sistema.
- **Tiempo real:** SignalR para el panel y WebSocket para las manillas. Las lecturas se actualizan sin recargar la página y el panel se reconecta solo.
- **Historial:** búsqueda que no distingue tildes, filtros y exportación de la página actual.
- **Sensores:**
  - El CO SEN0564 se lee mediante un ADS1115. Es un sensor **cualitativo**: informa ppm solo con una calibración de dos puntos; sin calibración informa su tensión y no genera alarma de CO. Espera su precalentamiento antes de leer.
  - El MLX90614 mide la temperatura ambiente y la de objeto.
  - Umbrales configurables de precaución y peligro. Por defecto: CO 35/200 ppm, ambiente 32/38 °C, objeto 60/90 °C.
- **Batería:** no hay medición; la interfaz muestra **Sin sensor**.
- **Zona:** es un dato que se asigna administrativamente a cada manilla, no una posición medida.
- **Comunicación hacia el minero:** solo mediante avisos predefinidos, sin texto libre.
- **Revisión de alertas:** marcar una alerta como revisada registra el autor y la fecha. No declara resuelto el incidente.
- **Seguridad:**
  - Cookies HttpOnly, SameSite Strict, con expiración de 8 h. Contraseñas de 10 caracteres como mínimo.
  - Cambiar contraseña, rol, correo o estado invalida las sesiones y revoca las conexiones en vivo.
  - Las credenciales de manilla se guardan como hash y se muestran una sola vez. Renovarlas o deshabilitar la manilla cierra su socket.
- **Controles propios:** selectores, tooltips, diálogos y validación son de la aplicación, nunca nativos del navegador. Funcionan con teclado y con gestos táctiles. Las pruebas de Playwright lo verifican.
- **Tecnología existente:** ASP.NET Core 10 + MySQL (EF Core), React 19 + TypeScript + Vite, SignalR e iconos lucide-react. El software del dispositivo es Python sobre Raspberry Pi Zero 2 W.
- **Estado del proyecto:**
  - Es un prototipo académico. Faltan el montaje físico, la validación eléctrica, la calibración real y la medición de autonomía.
  - Fuera del entorno de desarrollo hacen falta HTTPS y WSS.
  - No es un detector de gases certificado ni un equipo de protección personal.
  - No se fijó como requisito de la interfaz mostrar este aviso de prototipo.

## Brand Commitments

- **Nombre:** Mining System · Central de operaciones.
- **Idioma:** solo español, con la jornada y la hora de Bolivia (confirmado).
- **Terminología del dominio:** *manilla* (el nodo portátil), *central* (servidor, API y base de datos), *operador* (supervisor o administrador), *minero*, *reporte*, *aviso*, *alerta* y *zona*.
- **Paleta (confirmada como obligatoria):** blanco y `#DEC1AF`, `#491A06`, `#373946`, `#852A3B`, `#6C4B68`; solo modo claro y sin gradientes. Estos colores identifican la central y no expresan estados.
- **Colores de seguridad (confirmados el 2026-10-16):** verde, amarillo y rojo (referencia ISO 3864) solo para normal, precaución y peligro, siempre acompañados de texto o icono. La base es clara y neutra, como en una sala de control; se descartó un tema oscuro.
- **Activos:** `web-app/public/favicon.svg` y `web-app/public/icons.svg`.
- **Voz observada en la interfaz actual (no confirmada como compromiso):** directa y en segunda persona, centrada en el equipo. Por ejemplo: «La información esencial de tu operación, en un solo lugar.»

## Evidence on Hand

- **Documentación técnica:**
  - Informe final: `docs/informe_final_iot_2026.tex` y `docs/informe_final.pdf`.
  - Contrato de API y tiempo real: `docs/api.md`.
  - Base de datos: `docs/mysql.md` y `docs/mysql-schema.sql`.
  - Despliegue: `docs/docker.md`.
  - Hardware: `docs/hardware/oled-buttons.md`, `docs/componentes.tex` y `docs/conexiones.tex`.
- **Imágenes reales:**
  - Fotos de componentes en `docs/imagenes/`.
  - Diagrama de cableado: `docs/imagenes/cableado.png` y `docs/imagenes/cableado.svg`.
  - Vista previa del menú OLED: `docs/imagenes/oled-menu-preview.png`.
  - Circuito en Wokwi: `docs/wokwi/diagrama.png`.
- **Pruebas:**
  - Unitarias .NET, del dispositivo, de integración contra MySQL y WebSockets reales, y de navegador con Playwright.
  - Las capturas de Playwright quedan en `web-app/test-results/` y no están versionadas.
- **Discrepancia conocida:** la sección de alcances del informe da por pendientes los sensores, la voz y los actuadores. El README y el código de `device/src` los tienen integrados en el software. El README es la fuente vigente.
- **Ausencias (no inventar):**
  - No hay datos tomados en una mina real; las lecturas de las pruebas son datos controlados o simulados.
  - No hay autonomía medida.
  - No hay clientes, testimonios, despliegues en producción ni certificaciones.

## Product Principles

1. **La rapidez del aviso es tan importante como su contenido.** Un reporte crítico o un nivel de peligro debe abrirse paso por encima de todo lo demás en la central.
2. **Decir solo lo que se sabe.** Hay que distinguir siempre lo que está en cola de lo entregado, lo simulado de lo medido, lo revisado de lo resuelto y la tensión de las ppm. Un dato ausente se dice como ausente (**Sin sensor**). Nunca se rellena con datos de muestra.
3. **El historial no se reescribe.** Cada lectura y cada mensaje quedan atribuidos a quien llevaba la manilla y a la zona de ese momento. Desactivar no es borrar.
4. **Hecho para el turno completo.** La central permanece abierta horas en una sala de control. Debe mantenerse confiable y legible durante una vigilancia larga, y no solo en una revisión puntual.
5. **La manilla manda en la interacción del minero.** El minero solo tiene tres botones, guantes y una pantalla pequeña. La central se adapta a esos límites: avisos predefinidos y confirmación explícita, sin texto libre.

## Accessibility & Inclusion

No se fijó un estándar formal (como un nivel WCAG). Las pruebas de navegador exigen hoy que todos los controles propios funcionen con teclado (flechas, Inicio/Fin, AvPág/RePág, Enter/Espacio, Escape) y con gestos táctiles; el foco queda contenido en los diálogos y vuelve al control que los abrió. La interfaz respeta `prefers-reduced-motion`.
