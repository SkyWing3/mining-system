import React from "react";
import { C, inter, pixel } from "../theme";

// Pantallas tal como las dibuja device/src/display/renderer.py (SSD1306, 128x64).
export const PAGES = ["Estado", "Gases", "Temperatura", "Mensajes", "Ajustes"];
export const MESSAGES = [
  "Ayuda",
  "Todo bien",
  "Hay derrumbe",
  "Presencia de gas",
  "Companero herido",
  "Necesito evacuar",
  "Suministros",
  "Saliendo de mina",
  "< Volver",
];

export type OledScreen =
  | { kind: "menu"; selected: number }
  | { kind: "messages"; selected: number }
  | { kind: "confirm"; message: string; selected: number }
  | { kind: "result"; status: string; connected: boolean };

const INK = "#f4efe9";

const Row: React.FC<{ y: number; text: string; selected: boolean }> = ({ y, text, selected }) => (
  <>
    {selected && <rect x={2} y={y - 2} width={118} height={12} fill={INK} />}
    <text x={5} y={y + 7.5} fill={selected ? "#000" : INK} fontSize={8} fontFamily={pixel}>
      {text}
    </text>
  </>
);

const List: React.FC<{ items: string[]; selected: number; top: number }> = ({ items, selected, top }) => {
  const first = Math.max(0, Math.min(selected - 2, items.length - 3));
  const visible = items.slice(first, first + 3);
  const thumb = 36 / items.length;
  return (
    <>
      {visible.map((item, i) => (
        <Row key={item} y={top + i * 12} text={item} selected={first + i === selected} />
      ))}
      <line x1={124.5} x2={124.5} y1={top - 2} y2={top + 34} stroke={INK} strokeWidth={0.6} />
      <rect x={123} y={top - 2 + selected * thumb} width={3} height={Math.max(4, thumb)} fill={INK} />
    </>
  );
};

export const Oled: React.FC<{ screen: OledScreen; width: number }> = ({ screen, width }) => {
  const title =
    screen.kind === "menu" ? "MINING SYSTEM" : screen.kind === "result" ? "MENSAJES" : "MENSAJES";
  const footer =
    screen.kind === "menu"
      ? `${screen.selected + 1}/${PAGES.length}   ENTER: abrir`
      : screen.kind === "messages"
        ? "ENTER: seleccionar"
        : screen.kind === "confirm"
          ? "ENTER: confirmar"
          : "ENTER: volver";
  return (
    <svg width={width} height={width / 2} viewBox="0 0 128 64" style={{ display: "block" }}>
      <rect width={128} height={64} fill="#000" />
      <text x={3} y={8} fill={INK} fontSize={8} fontFamily={pixel}>
        {title}
      </text>
      <line x1={0} x2={128} y1={11.5} y2={11.5} stroke={INK} strokeWidth={0.7} />
      {screen.kind === "menu" && <List items={PAGES} selected={screen.selected} top={15} />}
      {screen.kind === "messages" && <List items={MESSAGES} selected={screen.selected} top={15} />}
      {screen.kind === "confirm" && (
        <>
          <text x={3} y={22} fill={INK} fontSize={8} fontFamily={pixel}>
            {screen.message}
          </text>
          <Row y={27} text="Enviar" selected={screen.selected === 0} />
          <Row y={39} text="Cancelar" selected={screen.selected === 1} />
        </>
      )}
      {screen.kind === "result" && (
        <>
          <text x={3} y={24} fill={INK} fontSize={8} fontFamily={pixel}>
            {screen.status}
          </text>
          <text x={3} y={37} fill={INK} fontSize={8} fontFamily={pixel}>
            {screen.connected ? "Central conectada" : "Central sin enlace"}
          </text>
          <text x={3} y={50} fill={INK} fontSize={8} fontFamily={pixel}>
            {"< Volver"}
          </text>
        </>
      )}
      <line x1={0} x2={128} y1={53.5} y2={53.5} stroke={INK} strokeWidth={0.7} />
      <text x={3} y={62} fill={INK} fontSize={7} fontFamily={pixel}>
        {footer}
      </text>
    </svg>
  );
};

const SideButton: React.FC<{ label: string; pressed: number }> = ({ label, pressed }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
    <div
      style={{
        width: 34,
        height: 74,
        borderRadius: "0 16px 16px 0",
        background: pressed > 0.5 ? C.wine : C.charcoal,
        translate: `${-12 * pressed}px 0px`,
      }}
    />
    <div
      style={{
        fontFamily: inter,
        fontSize: 26,
        fontWeight: 700,
        color: pressed > 0.5 ? C.wine : C.charcoal,
        letterSpacing: 2,
        opacity: 0.85,
      }}
    >
      {label}
    </div>
  </div>
);

export type Pressed = { up: number; down: number; enter: number };

// Manilla: correa, carcasa con OLED y tres pulsadores laterales.
export const Wristband: React.FC<{
  screen: OledScreen;
  pressed?: Pressed;
  showLabels?: boolean;
}> = ({ screen, pressed = { up: 0, down: 0, enter: 0 }, showLabels = true }) => (
  <div style={{ position: "relative", width: 760, height: 900 }}>
    {/* Correa */}
    <div
      style={{
        position: "absolute",
        left: 140,
        top: 0,
        width: 300,
        height: 900,
        borderRadius: 60,
        background: C.charcoal,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 138,
            top: 690 + i * 48,
            width: 24,
            height: 24,
            borderRadius: 12,
            background: "#24252e",
          }}
        />
      ))}
    </div>
    {/* Carcasa */}
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 230,
        width: 500,
        height: 380,
        borderRadius: 64,
        background: C.earth,
        boxShadow: "0 40px 80px rgba(73,26,6,0.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          padding: 26,
          borderRadius: 30,
          background: "#0b0b0d",
          border: `3px solid ${C.sand}`,
        }}
      >
        <Oled screen={screen} width={384} />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: inter,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 5,
          color: C.sand,
          opacity: 0.8,
        }}
      >
        MINING SYSTEM
      </div>
    </div>
    {/* Pulsadores */}
    <div
      style={{
        position: "absolute",
        left: 540,
        top: 276,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <SideButton label={showLabels ? "SUBIR" : ""} pressed={pressed.up} />
      <SideButton label={showLabels ? "BAJAR" : ""} pressed={pressed.down} />
      <SideButton label={showLabels ? "ENTER" : ""} pressed={pressed.enter} />
    </div>
  </div>
);
