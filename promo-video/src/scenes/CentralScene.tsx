import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Eyebrow, LogoMark } from "../components/Brand";
import { Icon, IconName } from "../components/Icon";
import { C, inter, out } from "../theme";

const ARRIVAL = 70;

const NAV: { icon: IconName; label: string }[] = [
  { icon: "grid", label: "Vista general" },
  { icon: "message", label: "Mensajes" },
  { icon: "alert", label: "Alertas" },
  { icon: "cpu", label: "Manillas" },
  { icon: "users", label: "Usuarios" },
  { icon: "activity", label: "Actividad" },
];

type Row = { text: string; who: string; zone: string; time: string; critical?: boolean };
const ROWS: Row[] = [
  { text: "Todo bien", who: "Ana Quispe", zone: "Galería sur", time: "10:41" },
  { text: "Necesito suministros", who: "Luis Mamani", zone: "Nivel 3", time: "10:18" },
  { text: "Saliendo de la mina", who: "Rosa Choque", zone: "Bocamina", time: "09:57" },
];

const MessageRow: React.FC<{ row: Row }> = ({ row }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "14px 22px",
      borderTop: `1px solid ${C.border}`,
      background: row.critical ? "#fbf3f4" : "#ffffff",
    }}
  >
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        background: row.critical ? C.wine : "#f2eeea",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={row.critical ? "alert" : "hardHat"} size={22} color={row.critical ? "#fff" : C.charcoal} />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.charcoal, display: "flex", gap: 10, alignItems: "center" }}>
        {row.text}
        {row.critical && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: C.wine,
              background: "#f4e2e5",
              padding: "4px 9px",
              borderRadius: 999,
            }}
          >
            CRÍTICO
          </span>
        )}
      </div>
      <div style={{ fontSize: 15, color: C.muted, marginTop: 3 }}>
        {row.who} · {row.zone}
      </div>
    </div>
    <div style={{ fontSize: 15, color: C.muted }}>{row.time}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; note: string; alert?: boolean; pulse?: number }> = ({
  label,
  value,
  note,
  alert,
  pulse = 0,
}) => (
  <div
    style={{
      flex: 1,
      borderRadius: 14,
      padding: "18px 20px",
      background: alert ? C.wine : "#ffffff",
      border: `1px solid ${alert ? C.wine : C.border}`,
      color: alert ? "#fff" : C.charcoal,
      scale: 1 + pulse * 0.05,
    }}
  >
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, opacity: 0.75 }}>{label}</div>
    <div style={{ fontSize: 46, fontWeight: 700, marginTop: 8 }}>{value}</div>
    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{note}</div>
  </div>
);

export const CentralScene: React.FC = () => {
  const frame = useCurrentFrame();
  const arrived = frame >= ARRIVAL;
  const pulse = interpolate(frame, [ARRIVAL, ARRIVAL + 6, ARRIVAL + 16], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rowIn = interpolate(frame, [ARRIVAL, ARRIVAL + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: out,
  });
  const toastIn = interpolate(frame, [ARRIVAL + 10, ARRIVAL + 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: out,
  });

  return (
    <AbsoluteFill name="Central" style={{ backgroundColor: "#f7f6f3", fontFamily: inter }}>
      <Sequence from={ARRIVAL} durationInFrames={60} layout="none">
        <Audio src="https://remotion.media/ding.wav" volume={0.45} />
      </Sequence>

      <Interactive.Div
        name="Copy"
        style={{
          position: "absolute",
          left: 120,
          top: 300,
          width: 560,
          opacity: interpolate(frame, [0, 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0, 30], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Eyebrow>La central</Eyebrow>
        <div style={{ marginTop: 22, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          El aviso llega al instante.
        </div>
        <div style={{ marginTop: 30, fontSize: 36, lineHeight: 1.4, color: C.charcoal }}>
          Supervisores y administradores lo ven en su panel y pueden actuar sin demora.
        </div>
      </Interactive.Div>

      {/* Ventana de la central */}
      <Interactive.Div
        name="App window"
        style={{
          position: "absolute",
          left: 740,
          top: 130,
          width: 1100,
          height: 820,
          borderRadius: 22,
          background: "#ffffff",
          boxShadow: "0 30px 90px rgba(55,57,70,0.18)",
          overflow: "hidden",
          display: "flex",
          opacity: interpolate(frame, [4, 24], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [4, 36], ["60px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div style={{ width: 230, borderRight: `1px solid ${C.border}`, padding: "26px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 6 }}>
            <LogoMark size={36} />
            <div style={{ fontSize: 14, color: C.charcoal, lineHeight: 1.1 }}>
              <b>MINING</b> SYSTEM
              <div style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 1.6 }}>SEGURIDAD CONECTADA</div>
            </div>
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.6, color: C.muted, margin: "30px 0 12px 8px" }}>
            CENTRAL DE OPERACIONES
          </div>
          {NAV.map((n, i) => (
            <div
              key={n.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 12px",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: i === 0 ? 700 : 500,
                color: i === 0 ? C.wine : C.charcoal,
                background: i === 0 ? "#f6ebe7" : "transparent",
              }}
            >
              <Icon name={n.icon} size={19} color={i === 0 ? C.wine : C.charcoal} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.label === "Alertas" && arrived && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: C.wine, borderRadius: 999, padding: "2px 8px" }}>
                  1
                </span>
              )}
            </div>
          ))}
          <div
            style={{
              marginTop: 330,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "12px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: C.charcoal,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.online }} />
            <div style={{ flex: 1 }}>
              <b>Central conectada</b>
              <div style={{ fontSize: 10, color: C.muted }}>Actualizaciones en tiempo real</div>
            </div>
            <Icon name="radio" size={16} color={C.charcoal} />
          </div>
        </div>

        <div style={{ flex: 1, padding: "30px 34px", background: "#f7f6f3", position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: C.muted }}>TU OPERACIÓN, CONECTADA</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: C.charcoal, marginTop: 6 }}>Vista general</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.charcoal, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px" }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: C.online }} />
              En tiempo real
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 22 }}>
            <Stat label="MINEROS REGISTRADOS" value="24" note="Personal con cuenta activa" />
            <Stat label="MANILLAS CONECTADAS" value={<>21<span style={{ fontSize: 22, opacity: 0.5 }}> / 24</span></>} note="Enlace en los últimos 90 s" />
            <Stat label="MENSAJES DE HOY" value={arrived ? "18" : "17"} note="Recibidos en la jornada" />
            <Stat label="ALERTAS PENDIENTES" value={arrived ? "1" : "0"} note={arrived ? "Reportes críticos por revisar" : "Sin reportes críticos"} alert pulse={pulse} />
          </div>

          <div
            style={{
              marginTop: 18,
              borderRadius: 12,
              border: `1px solid #ecd3d8`,
              background: "#fbf3f4",
              display: "flex",
              alignItems: "center",
              gap: 14,
              overflow: "hidden",
              height: interpolate(rowIn, [0, 1], [0, 66]),
              padding: interpolate(rowIn, [0, 1], [0, 1]) > 0 ? "0 18px" : 0,
              opacity: rowIn,
            }}
          >
            <Icon name="alert" size={24} color={C.wine} />
            <div style={{ flex: 1, fontSize: 15, color: C.charcoal }}>
              <b>Hay un reporte que requiere tu atención</b>
              <div style={{ fontSize: 13, color: C.muted }}>Consulta las alertas de tu equipo y registra su revisión.</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.wine }}>Ver alertas →</div>
          </div>

          <div style={{ marginTop: 18, background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ padding: "18px 22px 14px" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.charcoal }}>Últimos mensajes</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>Reportes enviados desde el terreno</div>
            </div>
            <div style={{ height: interpolate(rowIn, [0, 1], [0, 71]), overflow: "hidden", opacity: rowIn }}>
              <MessageRow row={{ text: "Hay derrumbe", who: "Nuevo Minero · Manilla de prueba", zone: "Zona norte", time: "Ahora", critical: true }} />
            </div>
            {ROWS.map((r) => (
              <MessageRow key={r.text} row={r} />
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              right: 30,
              bottom: 30,
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: C.wine,
              color: "#fff",
              borderRadius: 12,
              padding: "16px 20px",
              fontSize: 16,
              fontWeight: 600,
              boxShadow: "0 16px 40px rgba(133,42,59,0.3)",
              opacity: toastIn,
              translate: `0px ${(1 - toastIn) * 30}px`,
            }}
          >
            <Icon name="alert" size={22} color="#fff" />
            Hay derrumbe · Zona norte
            <span style={{ fontWeight: 700, marginLeft: 10, textDecoration: "underline" }}>Ver alerta</span>
          </div>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
