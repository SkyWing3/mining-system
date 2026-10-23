import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Eyebrow } from "../components/Brand";
import { Icon } from "../components/Icon";
import { C, inter, out } from "../theme";

const PLOT_W = 640;
const PLOT_H = 300;
const T_MIN = 10;
const T_MAX = 40;
const SKIN = 34;
const AMBIENT = 16;

const y = (t: number) => PLOT_H - ((t - T_MIN) / (T_MAX - T_MIN)) * PLOT_H;

// Curvas ilustrativas (no son mediciones).
const sudden = (x: number) => {
  const wobble = Math.sin(x * 37) * 0.25;
  if (x < 0.55) return SKIN + wobble;
  return AMBIENT + (SKIN - AMBIENT) * Math.exp(-(x - 0.55) * 60);
};
const gradual = (x: number) => SKIN - 12 * Math.pow(x, 1.4) + Math.sin(x * 29) * 0.2;

const N = 120;
const pointsOf = (fn: (x: number) => number) =>
  Array.from({ length: N + 1 }, (_, i) => [(i / N) * PLOT_W, y(fn(i / N))] as const);

const Chart: React.FC<{
  title: string;
  subtitle: string;
  axis: string;
  fn: (x: number) => number;
  start: number;
  duration: number;
  tag: string;
  tagNote: string;
}> = ({ title, subtitle, axis, fn, start, duration, tag, tagNote }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const pts = pointsOf(fn);
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const head = pts[Math.round(p * N)];
  const tagIn = interpolate(frame, [start + duration - 4, start + duration + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: out,
  });
  const current = fn(Math.round(p * N) / N);

  return (
    <div
      style={{
        width: 780,
        padding: "34px 40px 30px",
        borderRadius: 24,
        background: "#ffffff",
        border: `1px solid ${C.border}`,
        opacity: interpolate(frame, [start - 25, start - 5], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: `0px ${interpolate(frame, [start - 25, start], [30, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: out,
        })}px`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, color: C.charcoal }}>{title}</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 34, fontWeight: 700, color: C.earth }}>
          <Icon name="thermometer" size={30} color={C.earth} />
          {current.toFixed(1)} °C
        </div>
      </div>
      <svg width={PLOT_W + 60} height={PLOT_H + 46} style={{ marginTop: 26, overflow: "visible" }}>
        <g transform="translate(50 0)">
          <rect x={0} y={y(35.5)} width={PLOT_W} height={y(32) - y(35.5)} fill="#f1e2d9" />
          <text x={8} y={y(35.5) + 18} fontSize={15} fill={C.earth} fontFamily={inter} fontWeight={600}>
            Piel
          </text>
          <line x1={0} x2={PLOT_W} y1={y(AMBIENT)} y2={y(AMBIENT)} stroke={C.muted} strokeDasharray="6 8" strokeWidth={1.5} />
          <text x={PLOT_W - 4} y={y(AMBIENT) - 10} fontSize={15} fill={C.muted} fontFamily={inter} textAnchor="end">
            Ambiente de la mina
          </text>
          {[10, 20, 30, 40].map((t) => (
            <text key={t} x={-14} y={y(t) + 5} fontSize={15} fill={C.muted} fontFamily={inter} textAnchor="end">
              {t}°
            </text>
          ))}
          <line x1={0} x2={PLOT_W} y1={PLOT_H} y2={PLOT_H} stroke={C.border} strokeWidth={2} />
          <text x={0} y={PLOT_H + 32} fontSize={16} fill={C.muted} fontFamily={inter}>
            {axis}
          </text>
          <path d={d} fill="none" stroke={C.wine} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
          {p > 0 && <circle cx={head[0]} cy={head[1]} r={9} fill={C.wine} />}
        </g>
      </svg>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 20px",
          borderRadius: 14,
          background: C.wine,
          color: "#ffffff",
          opacity: tagIn,
          translate: `0px ${(1 - tagIn) * 16}px`,
        }}
      >
        <Icon name="alert" size={30} color="#ffffff" />
        <div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{tag}</div>
          <div style={{ fontSize: 20, opacity: 0.85 }}>{tagNote}</div>
        </div>
      </div>
    </div>
  );
};

export const TemperatureScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill name="Temperature" style={{ backgroundColor: "#f7f6f3", fontFamily: inter }}>
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
        <Eyebrow>Sensor infrarrojo orientado a la muñeca</Eyebrow>
        <div style={{ marginTop: 20, fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: C.earth }}>
          Si el minero no responde, la central aún tiene un indicio.
        </div>
      </Interactive.Div>
      <div style={{ position: "absolute", left: 160, top: 330, display: "flex", gap: 40 }}>
        <Chart
          title="Caída brusca"
          subtitle="De la piel al ambiente en pocos segundos"
          axis="Segundos"
          fn={sudden}
          start={40}
          duration={90}
          tag="La manilla se desprendió"
          tagNote="Por ejemplo, inmediatamente después de un derrumbe"
        />
        <Chart
          title="Descenso progresivo"
          subtitle="Hacia valores muy bajos, poco a poco"
          axis="Minutos"
          fn={gradual}
          start={150}
          duration={100}
          tag="Posible hipotermia"
          tagNote="Un indicio de su estado vital"
        />
      </div>
      <div style={{ position: "absolute", right: 160, bottom: 40, fontSize: 18, color: C.muted }}>Curvas ilustrativas</div>
    </AbsoluteFill>
  );
};
