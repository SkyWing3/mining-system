import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Eyebrow } from "../components/Brand";
import { Icon } from "../components/Icon";
import { OledScreen, Pressed, Wristband } from "../components/Wristband";
import { C, inter, out } from "../theme";

type Button = keyof Pressed;
const PRESSES: { f: number; b: Button }[] = [
  { f: 40, b: "down" },
  { f: 58, b: "down" },
  { f: 76, b: "down" },
  { f: 100, b: "enter" },
  { f: 124, b: "down" },
  { f: 142, b: "down" },
  { f: 170, b: "enter" },
  { f: 205, b: "enter" },
];
const DELIVERED_AT = 250;

const REPORTS = [
  "Ayuda",
  "Todo bien",
  "Hay derrumbe",
  "Presencia de gas",
  "Compañero herido",
  "Necesito evacuar",
  "Necesito suministros",
  "Saliendo de la mina",
];

// Reproduce la navegación de device/src/display/menu.py.
const screenAt = (frame: number): OledScreen => {
  let screen: OledScreen = { kind: "menu", selected: 0 };
  for (const p of PRESSES) {
    if (p.f > frame) break;
    if (screen.kind === "menu") {
      if (p.b === "down") screen = { kind: "menu", selected: (screen.selected + 1) % 5 };
      if (p.b === "enter") screen = { kind: "messages", selected: 0 };
    } else if (screen.kind === "messages") {
      if (p.b === "down") screen = { kind: "messages", selected: (screen.selected + 1) % 9 };
      if (p.b === "enter") screen = { kind: "confirm", message: "Hay derrumbe", selected: 0 };
    } else if (screen.kind === "confirm" && p.b === "enter") {
      screen = { kind: "result", status: "Guardado en cola", connected: true };
    }
  }
  if (screen.kind === "result" && frame >= DELIVERED_AT) {
    screen = { kind: "result", status: "Enviado a central", connected: true };
  }
  return screen;
};

const pressedAt = (frame: number): Pressed => {
  const value = (b: Button) =>
    Math.max(
      0,
      ...PRESSES.filter((p) => p.b === b).map((p) =>
        interpolate(frame, [p.f - 5, p.f - 1, p.f + 6], [0, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      ),
    );
  return { up: value("up"), down: value("down"), enter: value("enter") };
};

export const WristbandScene: React.FC = () => {
  const frame = useCurrentFrame();
  const screen = screenAt(frame);
  const delivered = frame >= DELIVERED_AT;
  const queued = frame >= 205;

  return (
    <AbsoluteFill name="Wristband" style={{ backgroundColor: "#f1e2d9", fontFamily: inter }}>
      {PRESSES.map((p) => (
        <Sequence key={p.f} from={p.f - 2} durationInFrames={20} layout="none">
          <Audio src="https://remotion.media/mouse-click.wav" volume={0.5} />
        </Sequence>
      ))}
      <Sequence from={DELIVERED_AT} durationInFrames={45} layout="none">
        <Audio src="https://remotion.media/ding.wav" volume={0.35} />
      </Sequence>

      <Interactive.Div
        name="Device"
        style={{
          position: "absolute",
          left: 120,
          top: 90,
          scale: interpolate(frame, [0, 30], [0.86, 0.95], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Wristband screen={screen} pressed={pressedAt(frame)} />
      </Interactive.Div>

      <div style={{ position: "absolute", left: 1000, top: 150, width: 800 }}>
        <Interactive.Div
          name="Heading"
          style={{
            opacity: interpolate(frame, [6, 24], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [6, 34], ["0px 40px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <Eyebrow>La manilla</Eyebrow>
          <div
            style={{
              marginTop: 22,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.05,
              color: C.earth,
            }}
          >
            Un aviso a tres botones de distancia.
          </div>
          <div style={{ marginTop: 30, fontSize: 36, lineHeight: 1.4, color: C.charcoal }}>
            Sin teléfono ni cobertura móvil: basta una red Wi-Fi local que enlace la manilla con la
            central.
          </div>
        </Interactive.Div>

        <div style={{ marginTop: 48, display: "flex", flexWrap: "wrap", gap: 14 }}>
          {REPORTS.map((r, i) => {
            const active = r === "Hay derrumbe" && frame >= 142;
            return (
              <div
                key={r}
                style={{
                  padding: "14px 22px",
                  borderRadius: 999,
                  fontSize: 26,
                  fontWeight: 600,
                  background: active ? C.wine : "#ffffff",
                  color: active ? "#ffffff" : C.charcoal,
                  border: `1.5px solid ${active ? C.wine : "#e3d3c8"}`,
                  opacity: interpolate(frame, [100 + i * 4, 112 + i * 4], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                  translate: `0px ${interpolate(frame, [100 + i * 4, 116 + i * 4], [16, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: out,
                  })}px`,
                }}
              >
                {r}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 44,
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            padding: "18px 28px",
            borderRadius: 14,
            background: delivered ? C.earth : "#ffffff",
            color: delivered ? C.sand : C.charcoal,
            fontSize: 30,
            fontWeight: 600,
            opacity: interpolate(frame, [205, 215], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: delivered
              ? interpolate(frame, [DELIVERED_AT, DELIVERED_AT + 6, DELIVERED_AT + 14], [1, 1.06, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 1,
          }}
        >
          <Icon name={delivered ? "checkCheck" : "database"} size={34} color={delivered ? C.sand : C.plum} />
          {delivered ? "Enviado a central" : queued ? "Guardado en cola" : ""}
        </div>
      </div>
    </AbsoluteFill>
  );
};
