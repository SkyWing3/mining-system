import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSilkscreen } from "@remotion/google-fonts/Silkscreen";
import { Easing } from "remotion";

// Paleta de la web-app (web-app/src/index.css): blanco como base, sin gradientes.
export const C = {
  sand: "#dec1af",
  sandLight: "#f1e2d9",
  earth: "#491a06",
  charcoal: "#373946",
  wine: "#852a3b",
  plum: "#6c4b68",
  muted: "#777581",
  border: "#e9e5e1",
  paper: "#ffffff",
  surface: "#f7f6f3",
  online: "#3f7d5c",
} as const;

export const inter = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
}).fontFamily;

export const pixel = loadSilkscreen("normal", {
  weights: ["400"],
  subsets: ["latin", "latin-ext"],
}).fontFamily;

export const out = Easing.bezier(0.16, 1, 0.3, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

export const FPS = 30;
export const TRANSITION = 15;
