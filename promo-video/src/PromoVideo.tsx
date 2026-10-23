import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import React from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { CentralScene } from "./scenes/CentralScene";
import { ExposureScene } from "./scenes/ExposureScene";
import { InsightScene } from "./scenes/InsightScene";
import { Intro } from "./scenes/Intro";
import { OfflineScene } from "./scenes/OfflineScene";
import { Outro } from "./scenes/Outro";
import { Problem } from "./scenes/Problem";
import { SETUP_DURATION, SetupScene } from "./scenes/SetupScene";
import { TemperatureScene } from "./scenes/TemperatureScene";
import { WristbandScene } from "./scenes/WristbandScene";
import { TRANSITION } from "./theme";

export const SCENES = [
  { id: "Intro", component: Intro, duration: 150, cut: "fade" },
  { id: "Problem", component: Problem, duration: 165, cut: "fade" },
  { id: "Wristband", component: WristbandScene, duration: 330, cut: "slide" },
  { id: "Central", component: CentralScene, duration: 240, cut: "slide" },
  { id: "Offline", component: OfflineScene, duration: 240, cut: "slide" },
  { id: "Temperature", component: TemperatureScene, duration: 330, cut: "fade" },
  { id: "Exposure", component: ExposureScene, duration: 240, cut: "slide" },
  { id: "Insight", component: InsightScene, duration: 210, cut: "fade" },
  { id: "Setup", component: SetupScene, duration: SETUP_DURATION, cut: "fade" },
  { id: "Outro", component: Outro, duration: 180, cut: "fade" },
] as const;

export const PROMO_DURATION =
  SCENES.reduce((acc, s) => acc + s.duration, 0) - (SCENES.length - 1) * TRANSITION;

// Fotograma donde empieza cada transición, para sincronizar los efectos de sonido.
const CUTS = SCENES.slice(0, -1).map(
  (_, i) => SCENES.slice(0, i + 1).reduce((acc, s) => acc + s.duration, 0) - (i + 1) * TRANSITION,
);

export const PromoVideo: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#491a06" }}>
      <Audio
        src={staticFile("music.wav")}
        volume={(f) =>
          interpolate(f, [0, 30, durationInFrames - 60, durationInFrames], [0, 0.55, 0.55, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      {CUTS.map((cut, i) =>
        SCENES[i].cut === "slide" ? (
          <Sequence key={cut} from={cut - 4} durationInFrames={40} layout="none">
            <Audio src="https://remotion.media/whoosh.wav" volume={0.25} />
          </Sequence>
        ) : null,
      )}
      <TransitionSeries>
        {SCENES.flatMap((scene, i) => {
          const Scene = scene.component;
          const items = [
            <TransitionSeries.Sequence key={scene.id} name={scene.id} durationInFrames={scene.duration}>
              <Scene />
            </TransitionSeries.Sequence>,
          ];
          if (i < SCENES.length - 1) {
            items.push(
              <TransitionSeries.Transition
                key={`${scene.id}-t`}
                presentation={scene.cut === "slide" ? slide({ direction: "from-right" }) : fade()}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />,
            );
          }
          return items;
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
