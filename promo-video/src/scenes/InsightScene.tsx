import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Eyebrow } from "../components/Brand";
import { Icon, IconName } from "../components/Icon";
import { C, inter, out } from "../theme";

const BAR_W = 820;
const WHO = 0.36;
const NIOSH = 0.68;

const WORKERS = [
  { name: "Trabajador A", value: 0.84, start: 30 },
  { name: "Trabajador B", value: 0.24, start: 48 },
];

const Outcome: React.FC<{ icon: IconName; title: string; text: string; start: number; dark?: boolean }> = ({
  icon,
  title,
  text,
  start,
  dark,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: out,
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 22,
        padding: "28px 30px",
        borderRadius: 20,
        background: dark ? C.earth : "#f1e2d9",
        color: dark ? C.sand : C.earth,
        opacity: p,
        translate: `${(1 - p) * 40}px 0px`,
      }}
    >
      <Icon name={icon} size={46} color={dark ? C.sand : C.earth} />
      <div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 24, marginTop: 8, lineHeight: 1.35, opacity: 0.85 }}>{text}</div>
      </div>
    </div>
  );
};

export const InsightScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill name="Insight" style={{ backgroundColor: "#ffffff", fontFamily: inter }}>
      <Interactive.Div
        name="Heading"
        style={{
          position: "absolute",
          left: 160,
          top: 90,
          width: 1600,
          opacity: interpolate(frame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Eyebrow>Contraste con valores de referencia</Eyebrow>
        <div style={{ marginTop: 20, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          Datos que se convierten en decisiones.
        </div>
      </Interactive.Div>

      <div style={{ position: "absolute", left: 160, top: 360, width: BAR_W }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: C.muted }}>EXPOSICIÓN ACUMULADA A CO</div>
        <div style={{ position: "relative", marginTop: 80 }}>
          {WORKERS.map((w) => {
            const grow = interpolate(frame, [w.start, w.start + 40], [0, w.value], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: out,
            });
            return (
              <div key={w.name} style={{ marginBottom: 46 }}>
                <div style={{ fontSize: 28, fontWeight: 600, color: C.charcoal, marginBottom: 14 }}>{w.name}</div>
                <div style={{ height: 52, borderRadius: 12, background: "#f7f6f3", overflow: "hidden" }}>
                  <div style={{ width: BAR_W * grow, height: 52, background: grow > NIOSH ? C.wine : C.plum, borderRadius: 12 }} />
                </div>
              </div>
            );
          })}
          {[
            { at: WHO, label: "Guía de calidad del aire OMS" },
            { at: NIOSH, label: "Límite ocupacional NIOSH" },
          ].map((m, i) => (
            <div
              key={m.label}
              style={{
                position: "absolute",
                left: BAR_W * m.at,
                top: -14,
                height: 310,
                borderLeft: `3px dashed ${C.charcoal}`,
                opacity: interpolate(frame, [12 + i * 8, 26 + i * 8], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              <div style={{ position: "absolute", top: i ? 296 : -44, left: 10, fontSize: 20, fontWeight: 600, color: C.charcoal, whiteSpace: "nowrap" }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "absolute", left: 1080, top: 360, width: 680, display: "flex", flexDirection: "column", gap: 24 }}>
        <Outcome icon="bed" title="Recomendar descanso" text="Por ejemplo, un mínimo de días de descanso a la semana." start={80} dark />
        <Outcome icon="shield" title="Constatar una exposición segura" text="Cuando el registro se mantiene por debajo de los valores de referencia." start={100} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 160,
          right: 160,
          bottom: 90,
          display: "flex",
          alignItems: "center",
          gap: 22,
          paddingTop: 30,
          borderTop: `1px solid ${C.border}`,
          fontSize: 32,
          color: C.charcoal,
          opacity: interpolate(frame, [130, 150], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Icon name="users" size={44} color={C.plum} />
        <span>
          Acumulado entre trabajadores, el historial ayuda a investigar los efectos de largo plazo del trabajo en mina.
        </span>
      </div>
    </AbsoluteFill>
  );
};
