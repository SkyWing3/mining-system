import { Composition, Folder } from "remotion";
import { PROMO_DURATION, PromoVideo, SCENES } from "./PromoVideo";
import { FPS } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="MiningSystem-Scenes">
        {SCENES.map((scene) => (
          <Composition
            key={scene.id}
            id={scene.id}
            component={scene.component}
            width={1920}
            height={1080}
            fps={FPS}
            durationInFrames={scene.duration}
          />
        ))}
      </Folder>
      <Composition
        id="MiningSystemPromo"
        component={PromoVideo}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={PROMO_DURATION}
      />
    </>
  );
};
