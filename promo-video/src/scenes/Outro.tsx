import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { LogoMark, Wordmark } from "../components/Brand";
import { Icon, IconName } from "../components/Icon";
import { C, inter } from "../theme";

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "radio", label: "Avisos en tiempo real" },
  { icon: "heart", label: "Indicios del estado vital" },
  { icon: "wind", label: "Historial de calidad del aire" },
];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      name="Outro"
      style={{
        backgroundColor: "#491a06",
        fontFamily: inter,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Interactive.Div
        name="Brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 34,
          opacity: interpolate(frame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <LogoMark size={110} bg={C.sand} fg={C.earth} />
        <Wordmark size={72} color={C.sand} />
      </Interactive.Div>
      <Interactive.Div
        name="Tagline"
        style={{
          marginTop: 80,
          fontSize: 110,
          fontWeight: 700,
          letterSpacing: -3,
          lineHeight: 1.05,
          color: "#ffffff",
          textAlign: "center",
          opacity: interpolate(frame, [16, 36], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [16, 46], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Cada conexión.
        <br />
        <span style={{ color: "#dec1af" }}>Una vida protegida.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Features"
        style={{
          marginTop: 80,
          display: "flex",
          gap: 54,
          opacity: interpolate(frame, [50, 70], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {FEATURES.map((f) => (
          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, color: C.sand }}>
            <Icon name={f.icon} size={36} color={C.sand} />
            {f.label}
          </div>
        ))}
      </Interactive.Div>
    </AbsoluteFill>
  );
};
