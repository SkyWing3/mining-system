import { Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, Series, staticFile, useCurrentFrame } from "remotion";
import { Eyebrow } from "../components/Brand";
import { C, inter } from "../theme";

const CARD_W = 1180;
const SCALE = CARD_W / 1920;

// Tramos de "Inicicación mining system.mp4" (segundos del original).
const STEPS = [
  { label: "Crea la cuenta de administración", from: 12.0, to: 14.5 },
  { label: "Registra cada manilla y su zona", from: 29.0, to: 32.0 },
  { label: "Da de alta mineros y supervisores", from: 62.0, to: 65.0 },
  { label: "Asigna cada manilla a su minero", from: 81.0, to: 84.5 },
];
const lengthOf = (s: (typeof STEPS)[number]) => Math.round((s.to - s.from) * 30);
const STARTS = STEPS.map((_, i) => STEPS.slice(0, i).reduce((acc, s) => acc + lengthOf(s), 0));
export const SETUP_DURATION = STEPS.reduce((acc, s) => acc + lengthOf(s), 0);

// Oculta el correo personal visible detrás del formulario de usuarios.
const Redact: React.FC<{ x: number; y: number; w: number; h: number }> = ({ x, y, w, h }) => (
  <div
    style={{
      position: "absolute",
      left: x * SCALE,
      top: y * SCALE,
      width: w * SCALE,
      height: h * SCALE,
      borderRadius: 6,
      backdropFilter: "blur(10px)",
      background: "rgba(120,118,125,0.35)",
    }}
  />
);

export const SetupScene: React.FC = () => {
  const frame = useCurrentFrame();
  const active = STARTS.filter((s) => frame >= s).length - 1;

  return (
    <AbsoluteFill name="Setup" style={{ backgroundColor: "#f1e2d9", fontFamily: inter }}>
      <Interactive.Div
        name="Copy"
        style={{
          position: "absolute",
          left: 120,
          top: 210,
          width: 520,
          opacity: interpolate(frame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Eyebrow>Puesta en marcha</Eyebrow>
        <div style={{ marginTop: 20, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          Tu central, lista en minutos.
        </div>
        <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 14 }}>
          {STEPS.map((s, i) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "14px 18px",
                borderRadius: 14,
                background: i === active ? "#ffffff" : "transparent",
                color: i === active ? C.earth : C.charcoal,
                opacity: i <= active ? 1 : 0.45,
                fontSize: 26,
                fontWeight: i === active ? 700 : 500,
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  background: i === active ? C.wine : i < active ? C.earth : "transparent",
                  border: `2px solid ${i <= active ? "transparent" : C.charcoal}`,
                  color: i <= active ? "#ffffff" : C.charcoal,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              {s.label}
            </div>
          ))}
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Footage"
        style={{
          position: "absolute",
          left: 680,
          top: 208,
          width: 1180,
          height: 664,
          borderRadius: 20,
          overflow: "hidden",
          background: "#ffffff",
          boxShadow: "0 30px 90px rgba(73,26,6,0.22)",
          opacity: interpolate(frame, [0, 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0, 30], ["60px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Series>
          {STEPS.map((s, i) => (
            <Series.Sequence key={s.label} name={s.label} durationInFrames={lengthOf(s)}>
              <AbsoluteFill>
                <Video
                  src={staticFile("demo.mp4")}
                  trimBefore={Math.round(s.from * 30)}
                  trimAfter={Math.round(s.to * 30)}
                  muted
                  style={{ width: CARD_W, height: (CARD_W * 9) / 16 }}
                />
                {i === 2 && <Redact x={395} y={528} w={210} h={48} />}
              </AbsoluteFill>
            </Series.Sequence>
          ))}
        </Series>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
