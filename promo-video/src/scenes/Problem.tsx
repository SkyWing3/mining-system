import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Icon } from "../components/Icon";
import { C, inter } from "../theme";

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      name="Problem"
      style={{
        backgroundColor: "#373946",
        fontFamily: inter,
        justifyContent: "center",
        paddingLeft: 160,
        paddingRight: 160,
      }}
    >
      <Interactive.Div
        name="No signal"
        style={{
          display: "flex",
          gap: 26,
          alignItems: "center",
          marginBottom: 56,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Icon name="phoneOff" size={64} color={C.sand} />
        <span style={{ fontSize: 34, color: C.sand, fontWeight: 600, letterSpacing: 1 }}>
          Sin servicio · Sin cobertura móvil
        </span>
      </Interactive.Div>
      <Interactive.Div
        name="Line 1"
        style={{
          fontSize: 120,
          fontWeight: 700,
          color: "#ffffff",
          letterSpacing: -3,
          lineHeight: 1.05,
          opacity: interpolate(frame, [8, 26], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [8, 36], ["0px 50px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Bajo tierra, un incidente
      </Interactive.Div>
      <Interactive.Div
        name="Line 2"
        style={{
          fontSize: 120,
          fontWeight: 700,
          color: "#dec1af",
          letterSpacing: -3,
          lineHeight: 1.05,
          opacity: interpolate(frame, [40, 58], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [40, 68], ["0px 50px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        no puede esperar.
      </Interactive.Div>
      <Interactive.Div
        name="Support"
        style={{
          marginTop: 56,
          fontSize: 44,
          color: "#dec1af",
          maxWidth: 1300,
          lineHeight: 1.35,
          opacity: interpolate(frame, [80, 100], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Reaccionar rápido y entender, con el tiempo, cómo el entorno afecta a quienes trabajan en él.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
