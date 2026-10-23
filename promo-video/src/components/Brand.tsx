import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, inter, out } from "../theme";

// Logo de la central (web-app/public/favicon.svg).
export const LogoMark: React.FC<{ size: number; bg?: string; fg?: string }> = ({
  size,
  bg = C.earth,
  fg = C.sand,
}) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <rect width="48" height="48" rx="10" fill={bg} />
    <path
      d="m7 34 11-18 6 8 6-13 12 23H7Zm16-12 4 7 5-7"
      fill="none"
      stroke={fg}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

export const Wordmark: React.FC<{
  size: number;
  color?: string;
  sub?: string;
  subColor?: string;
}> = ({ size, color = C.charcoal, sub = "SEGURIDAD CONECTADA", subColor }) => (
  <div style={{ fontFamily: inter, color, lineHeight: 1 }}>
    <div style={{ fontSize: size, letterSpacing: size * 0.02 }}>
      <span style={{ fontWeight: 800 }}>MINING</span>{" "}
      <span style={{ fontWeight: 500 }}>SYSTEM</span>
    </div>
    <div
      style={{
        fontSize: size * 0.36,
        fontWeight: 700,
        letterSpacing: size * 0.09,
        marginTop: size * 0.3,
        color: subColor ?? color,
      }}
    >
      {sub}
    </div>
  </div>
);

// Ilustración de la mina del login, dibujada trazo a trazo.
export const MineArt: React.FC<{
  width: number;
  color: string;
  start?: number;
  duration?: number;
}> = ({ width, color, start = 0, duration = 60 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: out,
  });
  const dash = (len: number, delay: number) => {
    const p = interpolate(progress, [delay, Math.min(1, delay + 0.6)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { strokeDasharray: len, strokeDashoffset: len * (1 - p) };
  };
  return (
    <svg width={width} height={(width * 210) / 520} viewBox="0 0 520 210" fill="none">
      <path
        d="M0 186 109 57 194 140 294 16 450 186H0Z"
        stroke={color}
        strokeWidth="1.5"
        style={dash(1500, 0)}
      />
      <path
        d="m109 57 10 64 30 17 45 2M294 16l-7 93 37-23 25 41 25 59M194 140l-24 46M294 16l-69 170M119 121l-45 65"
        stroke={color}
        strokeWidth="1.5"
        style={dash(900, 0.2)}
      />
      <path
        d="M0 204h510M250 204v-38a22 22 0 0 1 44 0v38m-35 0v-35a13 13 0 0 1 26 0v35"
        stroke={color}
        strokeWidth="1.5"
        style={dash(800, 0.4)}
      />
      <circle cx="272" cy="167" r="3" fill={color} opacity={interpolate(progress, [0.8, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </svg>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.plum,
}) => (
  <div
    style={{
      fontFamily: inter,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: 5,
      color,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);
