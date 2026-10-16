"""Códigos compartidos con backend/Domain/Catalogs.cs; textos cortos para la OLED."""

# Reportes que el minero elige en el menú Mensajes.
MESSAGES = (
    ("HELP", "Ayuda"),
    ("OK", "Todo bien"),
    ("COLLAPSE", "Hay derrumbe"),
    ("GAS", "Presencia de gas"),
    ("INJURY", "Companero herido"),
    ("EVACUATE", "Necesito evacuar"),
    ("SUPPLIES", "Suministros"),
    ("EXIT", "Saliendo de mina"),
)

# Alarmas que la manilla envía sola al alcanzar el umbral de peligro.
CO_ALARM = "CO_ALARM"
HEAT_ALARM = "HEAT_ALARM"
AUTOMATIC_MESSAGES = (CO_ALARM, HEAT_ALARM)

MESSAGE_CODES = frozenset(code for code, _ in MESSAGES) | frozenset(AUTOMATIC_MESSAGES)

# Avisos que la central puede enviar a la manilla.
NOTICES = {
    "EVACUATE": "Evacuar ahora",
    "SURFACE": "Volver a superficie",
    "SHELTER": "Ir al refugio",
    "HELP_COMING": "Ayuda en camino",
    "RECEIVED": "Mensaje recibido",
    "REPORT": "Reporta tu estado",
}
