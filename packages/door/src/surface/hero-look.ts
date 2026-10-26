import type { MediaSpec } from "@ep0ch/outline-core/media-line";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { surfaceRgb, theme, TONE_INDEX } from "../theme";

/**
 * A header image's look (PIE-1361): its own line's, and nothing else's. What its author left out is the built-in
 * (outline-core's HERO_PROPS say which); the look cascade gives only the colours it's drawn toward (`tone`, `bg`).
 */
export function heroLook(spec: MediaSpec, v: StyleValues) {
  return {
    ...spec,
    fit: spec.fit ?? "cover",
    focus: spec.focus ?? { x: 0.5, y: 0.5 },
    bleed: spec.bleed ?? "full",
    scroll: spec.scroll ?? "scroll",
    title: spec.title ?? "below",
    pixels: {
      dim: spec.dim,
      blur: spec.blur ?? 0,
      tint: spec.tint ?? 0, tone: theme().palette[TONE_INDEX[v.tone]]!,
      fade: spec.fade ?? 0,
      ground: surfaceRgb(v.bg, v["bg.strength"]) ?? theme().ground ?? theme().palette[0]!,
    },
  };
}
