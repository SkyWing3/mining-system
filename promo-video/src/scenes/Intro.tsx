import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { LogoMark, MineArt, Wordmark } from "../components/Brand";
import { C } from "../theme";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      name="Intro"
      style={{
        backgroundColor: "#491a06",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Interactive.Div
        name="Mine art"
        style={{
          position: "absolute",
          bottom: 110,
          opacity: interpolate(frame, [0, 10, 110, 150], [0, 0.9, 0.9, 0.35], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <MineArt width={1100} color={C.sand} start={0} duration={80} />
      </Interactive.Div>
      <Interactive.Div
        name="Brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 44,
          marginBottom: 560,
          opacity: interpolate(frame, [40, 65], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [40, 75], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <LogoMark size={150} bg={C.sand} fg={C.earth} />
        <Wordmark size={104} color={C.sand} />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
