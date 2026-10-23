import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Eyebrow, LogoMark } from "../components/Brand";
import { Icon } from "../components/Icon";
import { Oled } from "../components/Wristband";
import { C, inter, out } from "../theme";

const CUT = 50;
const RESTORE = 150;
const QUEUE = [
  { text: "Hay derrumbe", queuedAt: 70, sentAt: 172 },
  { text: "Compañero herido", queuedAt: 105, sentAt: 192 },
];
const LINK_X0 = 690;
const LINK_X1 = 1290;
const LINK_Y = 640;

export const OfflineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const online = frame < CUT || frame >= RESTORE;
  const pending = QUEUE.filter((q) => frame >= q.queuedAt && frame < q.sentAt).length;
  const allSent = frame >= QUEUE[QUEUE.length - 1].sentAt;

  // Paquetes que viajan por el enlace: latidos antes del corte y reenvío al reconectar.
  const packets = [
    ...[0, 18, 36].map((s) => ({ start: s, critical: false })),
    ...QUEUE.map((q) => ({ start: q.sentAt - 22, critical: true })),
  ];

  return (
    <AbsoluteFill name="Offline" style={{ backgroundColor: "#ffffff", fontFamily: inter }}>
      <Sequence from={CUT} durationInFrames={30} layout="none">
        <Audio src="https://remotion.media/switch.wav" volume={0.4} />
      </Sequence>
      <Sequence from={RESTORE} durationInFrames={30} layout="none">
        <Audio src="https://remotion.media/switch.wav" volume={0.4} />
      </Sequence>
      <Sequence from={QUEUE[1].sentAt} durationInFrames={45} layout="none">
        <Audio src="https://remotion.media/ding.wav" volume={0.3} />
      </Sequence>

      <Interactive.Div
        name="Heading"
        style={{
          position: "absolute",
          left: 160,
          top: 110,
          width: 1500,
          opacity: interpolate(frame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Eyebrow>Cola local</Eyebrow>
        <div style={{ marginTop: 22, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          Si se corta la red, el reporte no se pierde.
        </div>
        <div style={{ marginTop: 22, fontSize: 38, color: C.charcoal }}>
          La manilla lo conserva y lo reenvía al restablecerse la conexión.
        </div>
      </Interactive.Div>

      {/* Manilla */}
      <div
        style={{
          position: "absolute",
          left: 220,
          top: 470,
          width: 440,
          padding: 30,
          borderRadius: 40,
          background: C.earth,
        }}
      >
        <div style={{ padding: 14, borderRadius: 16, background: "#0b0b0d", border: `2px solid ${C.sand}` }}>
          <Oled
            width={352}
            screen={
              frame < QUEUE[0].queuedAt
                ? { kind: "menu", selected: 3 }
                : { kind: "result", status: allSent ? "Enviado a central" : "Guardado en cola", connected: online }
            }
          />
        </div>
      </div>
      <div style={{ position: "absolute", left: 220, top: 760, width: 440 }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3, color: C.muted, marginBottom: 12 }}>
          COLA EN LA MANILLA · {pending}
        </div>
        {QUEUE.map((q) => {
          const sent = frame >= q.sentAt;
          return (
            <div
              key={q.text}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px",
                marginBottom: 10,
                borderRadius: 12,
                background: sent ? "#f1e2d9" : "#f7f6f3",
                border: `1px solid ${C.border}`,
                fontSize: 24,
                color: C.charcoal,
                opacity: interpolate(frame, [q.queuedAt, q.queuedAt + 10], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                translate: `0px ${interpolate(frame, [q.queuedAt, q.queuedAt + 14], [20, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: out,
                })}px`,
              }}
            >
              <Icon name={sent ? "checkCheck" : "database"} size={26} color={sent ? C.earth : C.plum} />
              <b style={{ flex: 1 }}>{q.text}</b>
              <span style={{ fontSize: 18, color: sent ? C.earth : C.muted }}>{sent ? "Enviado" : "En cola"}</span>
            </div>
          );
        })}
      </div>

      {/* Enlace Wi-Fi */}
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={1920} height={1080}>
        {online ? (
          <line x1={LINK_X0} x2={LINK_X1} y1={LINK_Y} y2={LINK_Y} stroke={C.sand} strokeWidth={6} strokeLinecap="round" />
        ) : (
          <>
            <line x1={LINK_X0} x2={930} y1={LINK_Y} y2={LINK_Y} stroke="#d9d4cf" strokeWidth={6} strokeDasharray="4 16" strokeLinecap="round" />
            <line x1={1050} x2={LINK_X1} y1={LINK_Y} y2={LINK_Y} stroke="#d9d4cf" strokeWidth={6} strokeDasharray="4 16" strokeLinecap="round" />
          </>
        )}
        {packets.map((p, i) => {
          const progress = interpolate(frame, [p.start, p.start + 22], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.quad),
          });
          if (progress <= 0 || progress >= 1) return null;
          return (
            <circle
              key={i}
              cx={LINK_X0 + (LINK_X1 - LINK_X0) * progress}
              cy={LINK_Y}
              r={p.critical ? 16 : 10}
              fill={p.critical ? C.wine : C.plum}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 840,
          top: LINK_Y - 110,
          width: 300,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          fontSize: 24,
          fontWeight: 700,
          color: online ? C.charcoal : C.wine,
        }}
      >
        <Icon name={online ? "wifi" : "wifiOff"} size={54} color={online ? C.plum : C.wine} />
        {frame < CUT ? "Wi-Fi local" : online ? "Enlace restablecido" : "Sin enlace"}
      </div>

      {/* Central */}
      <div
        style={{
          position: "absolute",
          left: 1320,
          top: 470,
          width: 420,
          padding: "30px 30px",
          borderRadius: 24,
          background: "#f7f6f3",
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoMark size={52} />
          <div style={{ fontSize: 26, fontWeight: 700, color: C.charcoal }}>Central</div>
        </div>
        <div style={{ marginTop: 20, fontSize: 16, fontWeight: 700, letterSpacing: 2, color: C.muted }}>RECIBIDOS</div>
        {QUEUE.map((q) => (
          <div
            key={q.text}
            style={{
              marginTop: 12,
              padding: "12px 16px",
              borderRadius: 10,
              background: "#ffffff",
              border: `1px solid ${C.border}`,
              fontSize: 22,
              fontWeight: 600,
              color: C.wine,
              display: "flex",
              gap: 10,
              alignItems: "center",
              opacity: interpolate(frame, [q.sentAt, q.sentAt + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <Icon name="alert" size={22} color={C.wine} />
            {q.text}
          </div>
        ))}
        <div style={{ marginTop: 14, fontSize: 16, color: C.muted }}>Sin duplicados: cada reporte tiene un identificador estable.</div>
      </div>
    </AbsoluteFill>
  );
};
