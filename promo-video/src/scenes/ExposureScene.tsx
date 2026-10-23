import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, random, useCurrentFrame } from "remotion";
import { Eyebrow } from "../components/Brand";
import { C, inter } from "../theme";

const WEEKS = 52;
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const LEVELS = ["#efebe7", "#f1e2d9", "#dec1af", "#6c4b68", "#852a3b"];
const LEVEL_NAMES = ["Descanso", "Buena", "Moderada", "Mala", "Muy mala"];

// Historial ilustrativo de un trabajador: jornadas de 8 h, peor calidad a mitad de año.
const level = (week: number, day: number) => {
  if (day === 6 || (day === 5 && random(`rest-${week}`) > 0.35)) return 0;
  const season = Math.sin((week / WEEKS) * Math.PI);
  const v = season * 2.4 + random(`co-${week}-${day}`) * 1.9;
  return Math.min(4, Math.max(1, Math.round(v)));
};
const GRID = Array.from({ length: WEEKS }, (_, w) => DAYS.map((_, d) => level(w, d)));

const START = 30;
const END = 190;

export const ExposureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const revealed = interpolate(frame, [START, END], [0, WEEKS], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const poorDays = GRID.slice(0, Math.floor(revealed))
    .flat()
    .filter((l) => l >= 3).length;
  const workDays = GRID.slice(0, Math.floor(revealed))
    .flat()
    .filter((l) => l > 0).length;

  return (
    <AbsoluteFill name="Exposure" style={{ backgroundColor: "#ffffff", fontFamily: inter }}>
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
        <Eyebrow>Monóxido de carbono · calidad del aire</Eyebrow>
        <div style={{ marginTop: 20, fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          El valor de fondo está en los datos.
        </div>
        <div style={{ marginTop: 20, fontSize: 38, color: C.charcoal }}>
          Cada jornada queda registrada: la exposición acumulada a lo largo del año.
        </div>
      </Interactive.Div>

      <div style={{ position: "absolute", left: 160, top: 440, display: "flex", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 2 }}>
          {DAYS.map((d, i) => (
            <div key={i} style={{ height: 24, fontSize: 16, color: C.muted, lineHeight: "24px", width: 20 }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {GRID.map((col, w) => (
            <div key={w} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {col.map((l, d) => {
                const shown = interpolate(revealed, [w, w + 1.5], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                return (
                  <div
                    key={d}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: shown > 0 ? LEVELS[l] : "#f7f6f3",
                      opacity: 0.25 + shown * 0.75,
                      scale: 0.6 + shown * 0.4,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 194, top: 670, display: "flex", gap: 28, fontSize: 20, color: C.muted }}>
        {LEVELS.map((c, i) => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: c }} />
            {LEVEL_NAMES[i]}
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 160, top: 760, display: "flex", gap: 30 }}>
        {[
          { value: "8 h", label: "por jornada en la mina" },
          { value: `${workDays}`, label: "jornadas registradas" },
          { value: `${poorDays}`, label: "con aire de mala calidad", strong: true },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              width: 420,
              padding: "24px 30px",
              borderRadius: 20,
              background: s.strong ? C.earth : "#f7f6f3",
              color: s.strong ? C.sand : C.charcoal,
            }}
          >
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 24, marginTop: 4, opacity: 0.85 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 160, bottom: 40, fontSize: 18, color: C.muted }}>Ejemplo ilustrativo de un trabajador</div>
    </AbsoluteFill>
  );
};
